import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/ui/confirm";
import { supabase } from "@/integrations/supabase/client";
import { requireOrgId } from "@/lib/org";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { uuid } from "@/lib/uuid";
import {
  Plus, Loader2, Trash2, FileText, ImageIcon, Link2, Type, Upload, FolderOpen,
} from "lucide-react";

type Material = {
  id: string;
  kind: string;
  title: string;
  content: string | null;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
};

const KINDS = [
  { value: "imagem",    label: "Imagem",     icon: ImageIcon, hint: "Fotos de produto, ambiente, equipe" },
  { value: "copy",      label: "Texto/Copy", icon: Type,      hint: "Textos que a IA deve usar como referência" },
  { value: "documento", label: "Documento",  icon: FileText,  hint: "PDF, apresentação, manual da marca" },
  { value: "link",      label: "Link",       icon: Link2,     hint: "Site, rede social, matéria" },
];

function kindMeta(kind: string) {
  return KINDS.find((k) => k.value === kind) ?? KINDS[2];
}

export function BrandMaterials({ brandId, brandName }: { brandId?: string | null; brandName?: string }) {
  const [items, setItems] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // formulário
  const [kind, setKind] = useState("imagem");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const orgId = await requireOrgId();
      let q = supabase
        .from("brand_materials")
        .select("*")
        .eq("org_id", orgId);
      // Multi-cliente: mostra só o material da marca escolhida.
      if (brandId) q = q.eq("brand_id", brandId);
      const { data, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      setItems((data ?? []) as Material[]);
    } catch (err) {
      console.error("[materiais] falha ao carregar:", err);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  const reset = () => {
    setKind("imagem"); setTitle(""); setContent(""); setFile(null);
  };

  const save = async () => {
    if (!title.trim()) { toast.error("Dê um nome para este material."); return; }
    const precisaArquivo = kind === "imagem" || kind === "documento";
    if (precisaArquivo && !file) { toast.error("Escolha o arquivo."); return; }
    if (!precisaArquivo && !content.trim()) { toast.error("Escreva o conteúdo."); return; }

    setSaving(true);
    try {
      const orgId = await requireOrgId();
      const { data: { user } } = await supabase.auth.getUser();

      let file_url: string | null = null;
      let file_name: string | null = null;

      if (file) {
        const ext = file.name.split(".").pop() || "bin";
        const path = `${user?.id ?? orgId}/marca/${uuid()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("media").upload(path, file);
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("media").getPublicUrl(path);
        file_url = pub.publicUrl;
        file_name = file.name;
      }

      const { error } = await supabase.from("brand_materials").insert({
        org_id: orgId,
        brand_id: brandId ?? null,
        user_id: user?.id ?? null,
        kind,
        title: title.trim(),
        content: content.trim() || null,
        file_url,
        file_name,
      });
      if (error) throw error;

      toast.success("Material adicionado. A IA já pode usar como referência.");
      setOpen(false); reset(); void load();
    } catch (err) {
      const msg = err && typeof err === "object" && "message" in err
        ? String((err as { message: string }).message)
        : "Não foi possível salvar.";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const confirm = useConfirm();
  const remove = async (id: string) => {
    if (!(await confirm("Remover este material? A IA deixa de usá-lo."))) return;
    const { error } = await supabase.from("brand_materials").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Material removido.");
    void load();
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <FolderOpen className="h-5 w-5 text-primary" />
              {brandName ? `Materiais de ${brandName}` : "Materiais da marca"}
            </h3>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Tudo que você adicionar aqui vira referência para a IA: fotos dos produtos,
              textos que representam a voz da marca, documentos e links. Quanto mais
              material, mais fiel fica o conteúdo gerado.
            </p>
          </div>

          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" /> Adicionar
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Adicionar material</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={kind} onValueChange={(v) => { setKind(v); setFile(null); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label} — <span className="text-muted-foreground">{k.hint}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex.: Foto da pizza margherita, Manual de tom de voz…"
                  />
                </div>

                {(kind === "imagem" || kind === "documento") ? (
                  <div className="space-y-2">
                    <Label>Arquivo</Label>
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground hover:bg-accent">
                      <input
                        type="file"
                        className="hidden"
                        accept={kind === "imagem" ? "image/*" : ".pdf,.doc,.docx,.txt,.md,.ppt,.pptx"}
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                      <Upload className="h-4 w-4" />
                      {file ? file.name : "Escolher arquivo"}
                    </label>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>{kind === "link" ? "Endereço" : "Conteúdo"}</Label>
                    <Textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      rows={kind === "link" ? 2 : 6}
                      placeholder={
                        kind === "link"
                          ? "https://…"
                          : "Cole aqui o texto que representa a marca — uma legenda que deu certo, o manual de voz, a descrição de um produto…"
                      }
                    />
                  </div>
                )}

                {/* Descrição opcional para arquivos */}
                {(kind === "imagem" || kind === "documento") && (
                  <div className="space-y-2">
                    <Label>Observação <span className="text-muted-foreground">(opcional)</span></Label>
                    <Textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      rows={2}
                      placeholder="Explique quando a IA deve usar este material."
                    />
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                  Cancelar
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !items.length ? (
          <div className="rounded-lg border border-dashed py-10 text-center">
            <FolderOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Nenhum material ainda. Comece subindo fotos dos produtos ou um texto
              que represente bem a voz da marca.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((m) => {
              const { icon: Icon, label } = kindMeta(m.kind);
              return (
                <div key={m.id} className="flex gap-3 rounded-lg border p-3">
                  {m.kind === "imagem" && m.file_url ? (
                    <img src={m.file_url} alt={m.title} className="h-16 w-16 shrink-0 rounded object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-muted">
                      <Icon className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium">{m.title}</p>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                        onClick={() => remove(m.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Badge variant="secondary" className="mt-1 text-[10px] font-normal">{label}</Badge>
                    {m.content && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.content}</p>
                    )}
                    {m.file_url && m.kind !== "imagem" && (
                      <a
                        href={m.file_url} target="_blank" rel="noreferrer"
                        className="mt-1 block truncate text-xs text-primary hover:underline"
                      >
                        {m.file_name || "abrir arquivo"}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
