import { useState, useCallback, useEffect, useRef } from "react";
import {
  Image,
  Film,
  LayoutGrid,
  Eye,
  Send,
  Download,
  Trash2,
  ImageOff,
  Loader2,
  Play,
  Pencil,
  Upload,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MediaPreviewDialog } from "@/components/MediaPreviewDialog";
import { getCreations, deleteCreation, saveUploadToGallery, type Creation } from "@/lib/gallery";

// ─── Filter types ───────────────────────────────────────────────

type FilterType = "all" | "image" | "video" | "carousel";

const FILTERS: { value: FilterType; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "image", label: "Imagens" },
  { value: "video", label: "Vídeos" },
  { value: "carousel", label: "Carroséis" },
];

// ─── Component ──────────────────────────────────────────────────

export default function Gallery() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCreation, setPreviewCreation] = useState<Creation | null>(null);
  const [creations, setCreations] = useState<Creation[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Lê um arquivo do PC como data URL (base64). */
  const lerArquivo = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Não consegui ler "${file.name}".`));
      reader.readAsDataURL(file);
    });

  /**
   * Sobe uma ou mais imagens/vídeos do computador para a galeria. Depois é só
   * usar "Usar no post" para publicar nas redes. Útil quando o designer criou a
   * arte em outro lugar e você só quer subir e postar.
   */
  const handleUploadFiles = useCallback(async (files: FileList | null) => {
    const lista = Array.from(files || []).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
    );
    if (!lista.length) {
      toast({ title: "Escolha imagens ou vídeos", variant: "destructive" });
      return;
    }
    if (lista.length > 10) {
      toast({ title: "Envie no máximo 10 por vez", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const dataUrls = await Promise.all(lista.map(lerArquivo));
      const criacao = await saveUploadToGallery(dataUrls);
      if (!criacao) throw new Error("upload falhou");
      await loadCreations();
      toast({ title: lista.length > 1 ? `${lista.length} arquivos enviados` : "Arquivo enviado" });
    } catch (e) {
      toast({
        title: e instanceof Error && e.message !== "upload falhou" ? e.message : "Não consegui enviar. Tente de novo.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [toast, loadCreations]);

  const loadCreations = useCallback(async () => {
    setLoading(true);
    const data = await getCreations();
    setCreations(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCreations();
  }, [loadCreations]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteCreation(id);
    loadCreations();
    toast({ title: "Criação removida" });
  }, [toast, loadCreations]);

  const filtered =
    activeFilter === "all"
      ? creations
      : creations.filter((c) => c.type === activeFilter);

  // ── Handlers ────────────────────────────────────────────────

  function handleView(creation: Creation) {
    setPreviewCreation(creation);
    setPreviewOpen(true);
  }

  function handleUseInPost(creation: Creation) {
    navigate("/studio", { state: { mediaUrls: creation.urls, fromVisual: true } });
  }

  /**
   * Abre a criação no canvas do Studio para editar: as imagens viram slides
   * e a legenda vai junto. O Studio já entra no modo de edição quando recebe
   * mídia por navegação.
   */
  function handleEdit(creation: Creation) {
    const urls = creation.urls?.length ? creation.urls : (creation.thumbnailUrl ? [creation.thumbnailUrl] : []);
    if (!urls.length) {
      toast({ title: "Esta criação não tem imagem para editar", variant: "destructive" });
      return;
    }
    navigate("/studio", {
      state: {
        mediaUrls: urls,
        sourceContent: creation.prompt || "",
        sourceTitle: creation.templateName || "",
      },
    });
  }

  function handleDownload(creation: Creation) {
    const url = creation.thumbnailUrl ?? creation.urls[0];
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = creation.templateName ?? "download";
      a.target = "_blank";
      a.click();
    }
    toast({ title: "Download iniciado" });
  }

  function handleDeleteCreation(creation: Creation) {
    handleDelete(creation.id);
  }

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-h2Sm md:text-h2">
            <Image className="h-6 w-6 text-primary" />
            <span className="text-gradient-domani">Galeria de Criações</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Todas as suas criações salvas — imagens, vídeos e carroséis
          </p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => handleUploadFiles(e.target.files)}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Suba uma arte pronta do computador — depois é só 'Usar no post' para publicar nas redes"
          >
            {uploading
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Upload className="mr-2 h-4 w-4" />}
            {uploading ? "Enviando…" : "Enviar do computador"}
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={activeFilter === f.value ? "default" : "outline"}
            className={
              activeFilter === f.value
                ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                : ""
            }
            onClick={() => setActiveFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Grid or empty state */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-primary/40 bg-primary/5 py-20 text-center dark:bg-primary/10">
          <ImageOff className="mb-4 h-12 w-12 text-primary/60" />
          <p className="max-w-md text-sm text-muted-foreground">
            Nenhuma criação salva ainda. Crie visuais na aba{" "}
            <span className="font-medium text-primary">Criar Visual</span> e
            eles aparecerão aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((creation) => (
            <CreationCard
              key={creation.id}
              creation={creation}
              onView={handleView}
              onUseInPost={handleUseInPost}
              onEdit={handleEdit}
              onDownload={handleDownload}
              onDelete={handleDeleteCreation}
            />
          ))}
        </div>
      )}

      {/* Media Preview Dialog */}
      {previewCreation && (
        <MediaPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          urls={previewCreation.urls}
          title={previewCreation.templateName}
          onUseInPost={() => handleUseInPost(previewCreation)}
        />
      )}
    </div>
  );
}

// ─── Creation Card ────────────────────────────────────────────────

interface CreationCardProps {
  creation: Creation;
  onView: (c: Creation) => void;
  onUseInPost: (c: Creation) => void;
  onDownload: (c: Creation) => void;
  onEdit: (c: Creation) => void;
  onDelete: (c: Creation) => void;
}

function CreationCard({
  creation,
  onView,
  onUseInPost,
  onDownload,
  onEdit,
  onDelete,
}: CreationCardProps) {
  const thumb = creation.thumbnailUrl ?? creation.urls[0] ?? "";
  const isVideo = creation.type === "video";
  const [broken, setBroken] = useState(false);
  const date = new Date(creation.createdAt).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const showMedia = !!thumb && !broken;

  return (
    <Card className="group card-premium overflow-hidden">
      {/* Thumbnail — clicar abre o preview. Vídeo NÃO pode ir num <img>. */}
      <button
        type="button"
        onClick={() => onView(creation)}
        title="Ver"
        className="relative block aspect-square w-full overflow-hidden bg-muted"
      >
        {showMedia ? (
          isVideo ? (
            <video
              src={thumb}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setBroken(true)}
            />
          ) : (
            <img
              src={thumb}
              alt={creation.templateName ?? "Criação"}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setBroken(true)}
            />
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground/50">
            {isVideo ? <Film className="h-10 w-10" /> : <ImageOff className="h-10 w-10" />}
            <span className="text-[11px]">Prévia indisponível</span>
          </div>
        )}

        {/* Type overlay icon */}
        {isVideo && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1">
            <Play className="h-3.5 w-3.5 text-white" />
          </div>
        )}
        {creation.type === "carousel" && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1">
            <LayoutGrid className="h-4 w-4 text-white" />
            <span className="text-xs font-medium text-white">
              {creation.urls.length}
            </span>
          </div>
        )}
      </button>

      {/* Info + ações sempre visíveis (funciona no touch, contraste ok) */}
      <CardContent className="space-y-2 p-3">
        <p className="truncate text-sm font-medium">
          {creation.templateName ?? "Sem nome"}
        </p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{date}</p>
          {creation.published ? (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400">
              Publicado
            </Badge>
          ) : (
            <Badge variant="secondary">Rascunho</Badge>
          )}
        </div>
        <div className="flex items-center gap-1 pt-1">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 flex-1 gap-1.5 px-2"
            title="Ver"
            onClick={() => onView(creation)}
          >
            <Eye className="h-4 w-4" />
            <span className="text-xs">Ver</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 flex-1 gap-1.5 px-2"
            title="Abrir no canvas para editar"
            onClick={() => onEdit(creation)}
          >
            <Pencil className="h-4 w-4" />
            <span className="text-xs">Editar</span>
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            title="Usar em post"
            onClick={() => onUseInPost(creation)}
          >
            <Send className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            title="Baixar"
            onClick={() => onDownload(creation)}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 text-destructive hover:text-destructive"
            title="Excluir"
            onClick={() => onDelete(creation)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}