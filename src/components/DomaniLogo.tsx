import laranja from "@/assets/domani-laranja.png";
import chumbo from "@/assets/domani-chumbo.png";

type Props = {
  className?: string;
  size?: number;
  alt?: string;
  variant?: "laranja" | "chumbo";
};

/**
 * Logo oficial da Domani.
 *
 * Os arquivos agora são PNGs de verdade, importados pelo Vite (`src/assets/`).
 * Antes, o componente apontava para uma URL interna do Lovable
 * (`/__l5e/assets-v1/...`) — que só existia dentro do preview da plataforma.
 * Fora dela, o logo simplesmente não carregava no Login, no Setup e na sidebar.
 *
 * Para trocar a arte: substitua os PNGs em `src/assets/` mantendo os nomes.
 */
export function DomaniLogo({ className, size = 40, alt = "Domani.AI", variant = "laranja" }: Props) {
  const src = variant === "chumbo" ? chumbo : laranja;
  return (
    <img
      src={src}
      alt={alt}
      style={{ height: size, width: "auto" }}
      className={`object-contain ${className ?? ""}`}
      draggable={false}
    />
  );
}

export default DomaniLogo;
