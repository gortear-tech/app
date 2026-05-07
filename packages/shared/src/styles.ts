import type { VisualStyleIntensity } from "./states";

export interface VisualStyle {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  recommendedIndustries: string[];
  recommendedPhotoTypes: string[];
  intensity: VisualStyleIntensity;
  aiDisclosureRequired: boolean;
  restrictions: string[];
  isCustom?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface VisualStyleInput {
  name: string;
  description: string;
  promptTemplate: string;
  recommendedIndustries: string[];
  recommendedPhotoTypes: string[];
  intensity: VisualStyleIntensity;
  aiDisclosureRequired: boolean;
  restrictions: string[];
}

export interface CreateVisualStyleRequest extends VisualStyleInput {}

export interface UpdateVisualStyleRequest extends Partial<VisualStyleInput> {}

export const INITIAL_VISUAL_STYLES: readonly VisualStyle[] = [
  {
    id: "cyber-neon-alley",
    name: "Callejón cyberpunk",
    description: "Ambiente futurista con neones reflejados y fondo urbano desenfocado para destacar el producto.",
    promptTemplate:
      "Place the product in a futuristic cyberpunk alley with glowing neon signs, wet reflections and cinematic night lighting. Improve sharpness, dynamic range, color vibrancy and low-light quality while keeping the product highly detailed and isolated from the softly blurred urban background.",
    recommendedIndustries: ["sushi", "bar", "street food", "eventos"],
    recommendedPhotoTypes: ["producto", "platillo", "combo"],
    intensity: "fuerte",
    aiDisclosureRequired: true,
    restrictions: ["No alterar el diseño real del producto", "No modificar logos visibles", "No añadir texto nuevo"],
  },
  {
    id: "golden-hour-terrace",
    name: "Terraza al atardecer",
    description: "Escena cálida de golden hour con fondo elegante y profundidad cinematográfica.",
    promptTemplate:
      "Place the product on an elegant outdoor terrace during golden hour with warm sunlight, cinematic depth and softly blurred scenery. Enhance lighting, recover details, improve skin and food tones, and make the product visually rich and appetizing.",
    recommendedIndustries: ["restaurante", "cafetería", "sushi", "turismo"],
    recommendedPhotoTypes: ["producto", "platillo", "mesa"],
    intensity: "ligera",
    aiDisclosureRequired: true,
    restrictions: ["No cambiar ingredientes visibles", "No exagerar colores artificialmente", "No alterar precios o texto"],
  },
  {
    id: "floating-space-display",
    name: "Exhibición espacial",
    description: "Producto flotando en un ambiente espacial abstracto con iluminación premium.",
    promptTemplate:
      "Create a surreal outer-space inspired background with floating particles, cosmic lighting and soft nebula colors. Improve image quality, clarity and reflections while keeping the product centered, realistic and sharply separated from the abstract background.",
    recommendedIndustries: ["sushi", "tecnología", "productos premium", "eventos"],
    recommendedPhotoTypes: ["producto", "combo", "bebida"],
    intensity: "fuerte",
    aiDisclosureRequired: true,
    restrictions: ["No deformar el producto", "No cubrir el producto con efectos", "No modificar logos visibles"],
  },
  {
    id: "japanese-street-night",
    name: "Calle japonesa nocturna",
    description: "Escena inspirada en calles japonesas con luces cálidas y fondo cinematográfico.",
    promptTemplate:
      "Place the product in a cinematic Japanese street at night with glowing lanterns, soft rain reflections and shallow depth of field. Enhance image sharpness, color richness and ambient lighting while preserving the realism and visual focus of the product.",
    recommendedIndustries: ["sushi", "ramen", "restaurante asiático", "street food"],
    recommendedPhotoTypes: ["producto", "platillo", "persona"],
    intensity: "media",
    aiDisclosureRequired: true,
    restrictions: ["No agregar caracteres japoneses falsos", "No modificar ingredientes reales", "No alterar texto visible"],
  },
  {
    id: "volcanic-heat",
    name: "Ambiente volcánico",
    description: "Escenario intenso con rocas y calor visual que hace destacar el producto.",
    promptTemplate:
      "Create a dramatic volcanic-inspired environment with glowing lava reflections, smoky atmosphere and cinematic warm lighting. Improve overall brightness, texture detail and contrast while keeping the product clean, sharp and dominant in the foreground.",
    recommendedIndustries: ["hamburguesas", "sushi", "comida picante", "bbq"],
    recommendedPhotoTypes: ["producto", "platillo", "combo"],
    intensity: "fuerte",
    aiDisclosureRequired: true,
    restrictions: ["No quemar visualmente el producto", "No ocultar detalles importantes", "No modificar logos visibles"],
  },
  {
    id: "luxury-marble-studio",
    name: "Estudio mármol premium",
    description: "Escena minimalista premium con mármol, iluminación de estudio y fondo limpio.",
    promptTemplate:
      "Place the product in a luxury marble studio setup with premium reflections, soft studio shadows and elegant composition. Improve image clarity, lighting balance, color precision and texture quality while keeping the background clean and minimal.",
    recommendedIndustries: ["restaurante", "postres", "cosmética", "productos premium"],
    recommendedPhotoTypes: ["producto", "bebida", "empaque"],
    intensity: "ligera",
    aiDisclosureRequired: true,
    restrictions: ["No agregar objetos innecesarios", "No alterar colores corporativos", "No modificar texto visible"],
  },
  {
    id: "fantasy-forest-glow",
    name: "Bosque fantástico",
    description: "Fondo mágico con luces suaves y ambiente de fantasía cinematográfica.",
    promptTemplate:
      "Create a fantasy forest environment with glowing particles, soft magical lighting and cinematic depth. Enhance colors, remove camera noise and improve detail while keeping the product realistic, appetizing and clearly separated from the dreamy background.",
    recommendedIndustries: ["sushi", "postres", "cafetería", "eventos"],
    recommendedPhotoTypes: ["producto", "platillo", "bebida"],
    intensity: "media",
    aiDisclosureRequired: true,
    restrictions: ["No convertir el producto en caricatura completa", "No cubrir detalles del platillo", "No alterar logos visibles"],
  },
  {
    id: "retro-diner-glow",
    name: "Retro diner americano",
    description: "Escena vintage tipo diner con iluminación nostálgica y colores vivos.",
    promptTemplate:
      "Place the product inside a retro American diner with nostalgic neon lighting, glossy reflections and cinematic vintage tones. Improve sharpness, recover shadows and enrich colors while keeping the product highly detailed and visually dominant.",
    recommendedIndustries: ["hamburguesas", "malteadas", "sushi", "cafetería"],
    recommendedPhotoTypes: ["producto", "combo", "bebida"],
    intensity: "media",
    aiDisclosureRequired: true,
    restrictions: ["No añadir marcas falsas", "No modificar el producto principal", "No alterar texto o precios"],
  },
  {
    id: "snow-lodge-cinematic",
    name: "Refugio nevado",
    description: "Ambiente acogedor de nieve con iluminación cálida y contraste cinematográfico.",
    promptTemplate:
      "Place the product in a cozy snowy lodge environment with warm interior lighting contrasting against cold snowy scenery outside. Improve image quality, warmth, clarity and texture while softly blurring the background to emphasize the product.",
    recommendedIndustries: ["cafetería", "postres", "sushi", "comida comfort"],
    recommendedPhotoTypes: ["producto", "platillo", "bebida"],
    intensity: "ligera",
    aiDisclosureRequired: true,
    restrictions: ["No congelar visualmente el producto", "No cambiar colores reales de alimentos", "No modificar logos visibles"],
  },
  {
    id: "underwater-cinematic",
    name: "Escena submarina",
    description: "Fondo submarino cinematográfico con iluminación azul elegante y profundidad visual.",
    promptTemplate:
      "Create a cinematic underwater-inspired environment with soft blue lighting, floating particles and dramatic depth. Enhance image sharpness, remove noise and improve overall color quality while keeping the product realistic, bright and visually separated from the aquatic background.",
    recommendedIndustries: ["sushi", "mariscos", "restaurante", "eventos"],
    recommendedPhotoTypes: ["producto", "platillo", "combo"],
    intensity: "fuerte",
    aiDisclosureRequired: true,
    restrictions: ["No hacer que el producto parezca mojado", "No deformar ingredientes", "No alterar texto visible"],
  },
  {
    id: "cartoon-focus",
    name: "Caricatura con fondo suave",
    description: "Convierte la imagen en estilo caricaturesco, mejora iluminación y colores mientras suaviza el fondo para destacar el producto.",
    promptTemplate:
      "Transform the image into a polished cartoon style with enhanced lighting, richer colors, improved sharpness and better contrast. Keep the product crisp and visually appetizing, while softly blurring and simplifying the background so the main subject remains the clear focus.",
    recommendedIndustries: ["restaurante", "sushi", "cafetería", "comida rápida"],
    recommendedPhotoTypes: ["producto", "platillo", "combo"],
    intensity: "media",
    aiDisclosureRequired: true,
    restrictions: ["No cambiar la forma real del producto", "No alterar logos visibles", "No modificar texto o precios"],
  },
  {
    id: "rainy-window",
    name: "Lluvia en ventana",
    description: "Fondo lluvioso y acogedor con iluminación cálida mejorada y colores más cinematográficos.",
    promptTemplate:
      "Place the product in front of a cozy rainy window background with soft reflections, enhanced warm indoor lighting, cinematic color grading and improved image clarity. Keep the product crisp, bright and centered while the background stays softly blurred.",
    recommendedIndustries: ["restaurante", "sushi", "cafetería", "postres"],
    recommendedPhotoTypes: ["producto", "platillo", "mesa"],
    intensity: "media",
    aiDisclosureRequired: true,
    restrictions: ["No cubrir el producto con lluvia", "No alterar colores principales del platillo", "No modificar texto o precios"],
  },
  {
    id: "mountain-cabin-table",
    name: "Cabaña de montaña",
    description: "Ambiente cálido de cabaña con colores naturales reforzados e iluminación acogedora.",
    promptTemplate:
      "Place the product on a rustic wooden table inside a cozy mountain cabin. Improve overall lighting, increase warmth, enrich natural wood tones and enhance product clarity. Keep the background softly blurred while the product remains realistic, centered and visually dominant.",
    recommendedIndustries: ["restaurante", "sushi", "turismo", "comida artesanal"],
    recommendedPhotoTypes: ["producto", "platillo", "combo"],
    intensity: "media",
    aiDisclosureRequired: true,
    restrictions: ["No cambiar ingredientes visibles", "No deformar la presentación del platillo", "No alterar logos visibles"],
  },
  {
    id: "abstract-premium-glow",
    name: "Fondo abstracto premium",
    description: "Fondo abstracto elegante con iluminación tipo estudio y mejora avanzada de color.",
    promptTemplate:
      "Replace the background with an elegant abstract premium backdrop using soft gradients, subtle light streaks and studio-like depth. Improve image quality with brighter lighting, balanced highlights, cleaner shadows and richer colors while keeping the product highly detailed and realistic.",
    recommendedIndustries: ["restaurante", "moda", "cosmética", "productos premium"],
    recommendedPhotoTypes: ["producto", "platillo", "empaque"],
    intensity: "media",
    aiDisclosureRequired: true,
    restrictions: ["No añadir elementos que tapen el producto", "No modificar texto o precios", "No cambiar logos visibles"],
  },
  {
    id: "restaurant-depth",
    name: "Restaurante desenfocado",
    description: "Fondo de restaurante elegante con profundidad suave y mejora general de iluminación.",
    promptTemplate:
      "Place the product in a refined restaurant setting with warm ambient lighting, cinematic depth of field and enhanced color balance. Improve image clarity, brightness and contrast while keeping the product sharp, appetizing and clearly separated from the softly blurred background.",
    recommendedIndustries: ["restaurante", "sushi", "bar", "cocina gourmet"],
    recommendedPhotoTypes: ["producto", "platillo", "mesa"],
    intensity: "ligera",
    aiDisclosureRequired: true,
    restrictions: ["No agregar personas reconocibles", "No alterar el producto principal", "No modificar texto o precios"],
  },
  {
    id: "ocean-surreal",
    name: "Océano surreal",
    description: "Escena marina cinematográfica con iluminación épica y colores vibrantes.",
    promptTemplate:
      "Create a surreal ocean background with dramatic waves, cinematic lighting, enhanced reflections and vivid color grading. Improve overall image quality and brightness while keeping the product floating or placed safely in the foreground, sharp and visually dominant.",
    recommendedIndustries: ["sushi", "mariscos", "restaurante", "eventos"],
    recommendedPhotoTypes: ["producto", "platillo", "combo"],
    intensity: "fuerte",
    aiDisclosureRequired: true,
    restrictions: ["No mojar visualmente el producto", "No deformar el platillo", "No alterar logos visibles"],
  },
  {
    id: "anime-food-scene",
    name: "Escena anime gastronómica",
    description: "Escena anime vibrante con iluminación estilizada y colores intensificados.",
    promptTemplate:
      "Transform the image into a vibrant anime-inspired food scene with enhanced saturation, cinematic glow and cleaner lighting. Improve sharpness and color richness while keeping the product detailed and appetizing in the foreground with a softly stylized background.",
    recommendedIndustries: ["sushi", "restaurante", "postres", "comida juvenil"],
    recommendedPhotoTypes: ["producto", "platillo", "persona"],
    intensity: "fuerte",
    aiDisclosureRequired: true,
    restrictions: ["No cambiar identidad de personas", "No alterar ingredientes principales", "No modificar texto o precios"],
  },
  {
    id: "dark-menu-spotlight",
    name: "Spotlight de menú oscuro",
    description: "Iluminación dramática tipo menú premium con mejoras fuertes de nitidez y contraste.",
    promptTemplate:
      "Create a dark premium menu-style background with subtle texture and a focused spotlight on the product. Improve detail, sharpness, highlights and color depth while keeping the product realistic, bright and centered against a softened dark background.",
    recommendedIndustries: ["restaurante", "sushi", "bar", "hamburguesas"],
    recommendedPhotoTypes: ["producto", "platillo", "combo"],
    intensity: "media",
    aiDisclosureRequired: true,
    restrictions: ["No oscurecer demasiado el producto", "No alterar logos visibles", "No modificar texto o precios"],
  },
  {
    id: "nature-picnic-blur",
    name: "Picnic natural desenfocado",
    description: "Entorno natural luminoso con verdes intensificados y mejora de claridad.",
    promptTemplate:
      "Place the product in a natural picnic-style setting with greenery, soft sunlight and a blurred outdoor background. Improve brightness, natural colors, clarity and overall image quality while keeping the product clean, appetizing and sharply focused.",
    recommendedIndustries: ["restaurante", "sushi", "cafetería", "productos orgánicos"],
    recommendedPhotoTypes: ["producto", "platillo", "bebida"],
    intensity: "ligera",
    aiDisclosureRequired: true,
    restrictions: ["No añadir suciedad al producto", "No cambiar colores reales del platillo", "No modificar texto o precios"],
  },
  {
    id: "giant-creature-comedy",
    name: "Criatura gigante cómica",
    description: "Escena fantástica caricaturesca con iluminación cinematográfica y colores reforzados.",
    promptTemplate:
      "Create a slightly cartoonish fantasy background with a giant creature reacting to the product in the distance. Improve image lighting, color vibrancy, sharpness and cinematic atmosphere while keeping the product large, detailed and visually dominant in the foreground.",
    recommendedIndustries: ["sushi", "restaurante", "comida rápida", "eventos"],
    recommendedPhotoTypes: ["producto", "platillo", "combo"],
    intensity: "fuerte",
    aiDisclosureRequired: true,
    restrictions: ["No hacer que la criatura tape el producto", "No deformar el platillo", "No alterar logos visibles"],
  },
] as const;
