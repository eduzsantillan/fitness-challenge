import type { Motivation } from './challenge-helpers';
export const COMPACT_MESSAGES = {
  upcoming: ['Pronto empieza el pique.', 'Las zapatillas ya tienen plan.', 'Tu próxima excusa para salir.', 'La salida está cerca.', 'El sofá todavía no sospecha nada.', 'Calienta la playlist. Ya casi.'],
  'no-data': ['Falta recibir tus pasos.', 'Tu atajo aún no nos contó nada.', 'Caminar cuenta. Sincronizar también.', 'Tus pasos esperan su entrada.', 'Ejecuta tu atajo para empezar.', 'El marcador espera noticias tuyas.'],
  starting: ['Todo empieza por un paso.', 'Marcador en cero. Sin prisa.', 'El primer paseo abre la historia.', 'Tus zapatillas tienen la palabra.', 'Un pequeño paseo, un buen comienzo.', 'El sofá propone empezar mañana. Tú verás.'],
  solo: ['Falta tu rival favorito.', 'Invita a alguien y empieza el pique.', 'Esto mejora con compañía.', 'Hay sitio para otra playlist.', 'Tu grupo empieza con una invitación.', 'El sofá no cuenta como rival.'],
  behind: ['Vas detrás. La historia sigue abierta.', 'Un paseo puede cambiar el guion.', 'Las remontadas empiezan con un paso.', 'El sofá está animando al rival.', 'A tu ritmo. El reto sigue.', 'Todavía queda camino.'],
  leading: ['Vas primero. Mantén tu ritmo.', 'Tus zapatillas llevan la delantera.', 'El sofá te está perdiendo de vista.', 'Primero por ahora. Buen paseo.', 'Vas marcando el camino.', 'La corona aún es de papel.'],
  tied: ['Empate. Esto se pone bueno.', 'Ni un paso de diferencia.', 'Mismo marcador, distintas zapatillas.', 'El sofá pide un desempate.', 'El próximo paseo puede decidir.', 'Un empate de los buenos.'],
  finishing: ['Último tramo. Vas por delante.', 'La meta está cerca. A tu ritmo.', 'El premio ya te guiña un ojo.', 'El confeti sigue en su caja.', 'Últimos días. Buen ritmo.', 'Casi en la meta. Sin prisas.'],
} as const;
/** One short sentence; never repeats a potentially long user-written prize. */
export function compactMotivation(motivation: Motivation): string {
  const messages = COMPACT_MESSAGES[motivation.scenario as keyof typeof COMPACT_MESSAGES];
  if (!messages) return 'Cada paso cuenta.';
  let hash = 0;
  for (const character of motivation.message) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  return messages[(hash >>> 0) % messages.length]!;
}
