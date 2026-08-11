export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "773443429621-49hrr5i9mnb6khqrf1hkh7ah77br0vfb.apps.googleusercontent.com";
  return Response.json({ configured: Boolean(clientId), clientId });
}
