export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  return Response.json({ configured: Boolean(clientId), clientId });
}
