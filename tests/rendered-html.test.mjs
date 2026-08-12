import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders Brisa with its essential mobile flows", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Brisa/);
  assert.match(html, /Descarga mental/);
  assert.match(html, /Bandeja/);
  assert.match(html, /Próximo/);
  assert.match(html, /Explorar/);
  assert.match(html, /manifest\.webmanifest/);
  assert.doesNotMatch(html, /codex-preview|Starter Project|Your site is taking shape/);
});

test("keeps tasks local and supports voice and portable backups", async () => {
  const [page, groqRoute, googleConfigRoute, manifest, serviceWorker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/transcribe/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/google-config/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /localStorage\.setItem/);
  assert.match(page, /createScriptProcessor/);
  assert.match(page, /mediaDevices\.getUserMedia/);
  assert.match(page, /@huggingface\/transformers/);
  assert.match(page, /onnx-community\/whisper-small/);
  assert.match(page, /\/api\/transcribe/);
  assert.doesNotMatch(page, /GROQ_API_KEY/);
  assert.match(groqRoute, /process\.env\.GROQ_API_KEY/);
  assert.match(groqRoute, /whisper-large-v3/);
  assert.match(page, /Transcripción de la sesión/);
  assert.match(page, /Orden aplicada:/);
  assert.match(page, /he eliminado/);
  assert.match(page, /Editar detalles de/);
  assert.match(page, /type="date"/);
  assert.match(page, /type="time"/);
  assert.match(page, /task-edit-btn/);
  assert.match(page, /Guardar cambios/);
  assert.match(page, /Eliminar tarea/);
  assert.match(page, /view === "browse"/);
  assert.match(page, /Mis Proyectos/);
  assert.match(page, /Nombre de la sección/);
  assert.match(page, /Subtareas/);
  assert.match(page, /Comentarios/);
  assert.match(page, /Recordatorio/);
  assert.match(page, /Duplicar sección/);
  assert.match(page, /Archivar sección/);
  assert.match(page, /Gestionar proyectos/);
  assert.match(page, /Filtros y Etiquetas/);
  assert.match(page, /Reportes/);
  assert.match(page, /matchesSavedFilter/);
  assert.match(page, /Notification\.requestPermission/);
  assert.match(page, /function moveTask/);
  assert.match(page, /SECTIONS_KEY/);
  assert.match(page, /PROJECTS_KEY/);
  assert.match(page, /Nombre del proyecto/);
  assert.match(page, /Buscar en Brisa/);
  assert.match(page, /Etiquetas/);
  assert.match(page, /beforeinstallprompt/);
  assert.match(page, /Instalar en Android/);
  assert.match(page, /googleCalendarUrl/);
  assert.match(page, /Google Calendar/);
  assert.match(page, /calendarRequested/);
  assert.match(page, /Duración del evento/);
  assert.match(page, /calendar\.events\.owned/);
  assert.match(page, /www\.googleapis\.com\/calendar\/v3/);
  assert.match(page, /calendarEventId/);
  assert.match(page, /Google Calendar conectado/);
  assert.doesNotMatch(page, /\.apps\.googleusercontent\.com/);
  assert.match(googleConfigRoute, /process\.env\.GOOGLE_CLIENT_ID/);
  assert.match(page, /function openProject/);
  assert.match(page, /Proyecto creado y abierto/);
  assert.match(page, /Se añadirá a/);
  assert.match(page, /empty-voice/);
  assert.match(page, /Las tareas de esta sesión se añadirán a/);
  assert.match(page, /exportBackup/);
  assert.match(page, /importBackup/);
  assert.equal(JSON.parse(manifest).display, "standalone");
  assert.match(serviceWorker, /caches\.open/);
});
