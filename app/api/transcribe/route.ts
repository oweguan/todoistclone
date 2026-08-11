const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

function apiKey() {
  return process.env.GROQ_API_KEY?.trim();
}

export async function GET() {
  return Response.json({ configured: Boolean(apiKey()) });
}

export async function POST(request: Request) {
  const key = apiKey();
  if (!key) return Response.json({ error: "Groq no está configurado." }, { status: 503 });

  try {
    const incoming = await request.formData();
    const audio = incoming.get("audio");
    const context = String(incoming.get("context") || "").slice(0, 800);
    if (!(audio instanceof File) || audio.size === 0) return Response.json({ error: "No se recibió audio." }, { status: 400 });

    const groqForm = new FormData();
    groqForm.append("file", audio, "brisa.wav");
    groqForm.append("model", "whisper-large-v3");
    groqForm.append("language", "es");
    groqForm.append("response_format", "json");
    groqForm.append("temperature", "0");
    if (context) groqForm.append("prompt", `Transcribe tareas en español. Respeta exactamente estos nombres, proyectos y términos: ${context}`);

    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: groqForm,
    });
    const payload = await response.json() as { text?: string; error?: { message?: string } };
    if (!response.ok) {
      const detail = response.status === 401 ? "La clave de Groq no es válida." : response.status === 429 ? "Se alcanzó temporalmente el límite gratuito de Groq." : payload.error?.message || "Groq no pudo transcribir el audio.";
      return Response.json({ error: detail }, { status: response.status });
    }
    return Response.json({ text: payload.text?.trim() || "", provider: "groq", model: "whisper-large-v3" });
  } catch {
    return Response.json({ error: "No se pudo conectar con Groq." }, { status: 502 });
  }
}
