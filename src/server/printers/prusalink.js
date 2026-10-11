// PrusaLink (MINI, MK3.5/MK4/S, Core One, XL). Liefert das Status-Format, das alle
// anderen Adapter nachbilden: { printer: {...}, job: {...}|null, storage }.

export async function pollPrusaLink(client) {
  const [status, jobRes] = await Promise.all([
    client.json('/api/v1/status'),
    client.request('/api/v1/job').catch(() => null),
  ]);
  let job = null;
  if (jobRes?.ok && jobRes.status !== 204) {
    job = await jobRes.json().catch(() => null);
  } else {
    await jobRes?.body?.cancel().catch(() => {});
  }
  return {
    printer: status.printer ?? {},
    job: job ?? status.job ?? null,
    storage: status.storage ?? null,
  };
}
