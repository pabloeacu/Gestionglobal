// diasHabiles · espejo JS de private.dias_habiles_add (mig 0117): suma N días
// corridos salteando sábados y domingos. Se usa para las alarmas de
// seguimiento creadas desde el frontend (DGG-133 · poder de insistencia).

export function addDiasHabiles(desde: Date, dias: number): Date {
  const d = new Date(desde.getTime());
  let restantes = Math.max(0, Math.trunc(dias));
  while (restantes > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay(); // 0=domingo, 6=sábado
    if (dow !== 0 && dow !== 6) restantes--;
  }
  return d;
}
