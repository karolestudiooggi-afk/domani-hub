import { useState, useMemo } from "react";
import { useBrands } from "@/hooks/use-brands";
import { BrandMaterials } from "@/components/brands/BrandMaterials";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, FolderUp, Building2 } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * CONTEÚDO DOS CLIENTES
 *
 * Uma tela por cliente: escolhe a marca no topo e sobe os materiais dela
 * (fotos, textos, documentos, links). É esse acervo que a IA passa a usar
 * como referência ao gerar conteúdo para aquele cliente.
 */
export default function Content() {
  const { brands, loading } = useBrands();
  const [brandId, setBrandId] = useState<string>("");

  // Pré-seleciona a marca padrão assim que a lista carrega.
  const selected = useMemo(() => {
    if (brandId) return brands.find((b) => b.id === brandId) ?? null;
    return brands.find((b) => b.is_default) ?? brands[0] ?? null;
  }, [brandId, brands]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FolderUp className="h-6 w-6 text-primary" />
          Conteúdo dos <span className="text-gradient-domani">clientes</span>
        </h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Escolha o cliente e envie o material dele: fotos de produto, textos que
          representam a voz da marca, documentos e links. A IA passa a usar esse
          acervo como fonte de verdade ao criar conteúdo para esse cliente.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !brands.length ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="mb-4 h-12 w-12 text-muted-foreground/40" />
            <p className="mb-4 max-w-md text-muted-foreground">
              Você ainda não tem clientes cadastrados. Crie a marca do cliente
              primeiro — depois volta aqui para subir o conteúdo dele.
            </p>
            <Button asChild>
              <Link to="/brands">Cadastrar cliente</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Seletor de cliente */}
          <Card>
            <CardContent className="pt-6">
              <div className="max-w-md space-y-2">
                <Label>Cliente</Label>
                <Select
                  value={selected?.id ?? ""}
                  onValueChange={setBrandId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                        {b.is_default ? " (padrão)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  O material enviado fica vinculado a este cliente e só é usado
                  no conteúdo dele.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Materiais do cliente escolhido */}
          {selected && (
            <BrandMaterials
              key={selected.id}
              brandId={selected.id}
              brandName={selected.name}
            />
          )}
        </>
      )}
    </div>
  );
}
