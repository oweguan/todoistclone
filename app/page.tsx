"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type View = "inbox" | "today" | "upcoming" | "completed";
type Priority = 1 | 2 | 3 | 4;
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type GoogleTokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string };
type GoogleTokenClient = { callback: (response: GoogleTokenResponse) => void; requestAccessToken: (options?: { prompt?: string }) => void };
declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient: (options: { client_id: string; scope: string; callback: (response: GoogleTokenResponse) => void }) => GoogleTokenClient; revoke: (token: string, callback?: () => void) => void } } };
  }
}
type Task = {
  id: string;
  title: string;
  description?: string;
  project: string;
  due?: string;
  time?: string;
  recurring?: string;
  priority: Priority;
  labels: string[];
  completed: boolean;
  createdAt: string;
  completedAt?: string;
  calendarRequested?: boolean;
  calendarOpenedAt?: string;
  durationMinutes?: number;
  calendarEventId?: string;
  calendarSyncedAt?: string;
  calendarSyncState?: "pending" | "synced" | "error";
};

const STORAGE_KEY = "brisa.tasks.v1";
const PROJECTS_KEY = "brisa.projects.v1";
const PROJECTS = ["Bandeja de entrada", "Personal", "Trabajo", "Administración"];

const seedTasks: Task[] = [
  {
    id: "welcome-1",
    title: "Prueba la Descarga mental",
    description: "Pulsa el botón de ondas y cuéntale a Brisa todo lo que tienes en la cabeza.",
    project: "Bandeja de entrada",
    due: todayISO(),
    priority: 2,
    labels: ["primeros-pasos"],
    completed: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: "welcome-2",
    title: "Revisar las tareas de esta semana",
    project: "Personal",
    due: addDaysISO(2),
    priority: 3,
    labels: [],
    completed: false,
    createdAt: new Date().toISOString(),
  },
];

export function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function addDaysISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function addDaysToISO(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 10);
}

function compactCalendarDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

export function googleCalendarUrl(task: Task) {
  if (!task.due) return "";
  let dates: string;
  if (task.time) {
    const start = new Date(`${task.due}T${task.time}:00`);
    const end = new Date(start.getTime() + (task.durationMinutes || 30) * 60_000);
    dates = `${compactCalendarDate(start)}/${compactCalendarDate(end)}`;
  } else {
    dates = `${task.due.replaceAll("-", "")}/${addDaysToISO(task.due, 1).replaceAll("-", "")}`;
  }
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: task.title,
    dates,
    details: [task.description, `Proyecto: ${task.project}`, task.labels.length ? `Etiquetas: ${task.labels.map((label) => `@${label}`).join(" ")}` : ""].filter(Boolean).join("\n"),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function googleCalendarEvent(task: Task) {
  if (!task.due) return null;
  const description = [task.description, `Proyecto de Brisa: ${task.project}`, task.labels.length ? `Etiquetas: ${task.labels.map((label) => `@${label}`).join(" ")}` : ""].filter(Boolean).join("\n");
  if (!task.time) return { summary: task.title, description, start: { date: task.due }, end: { date: addDaysToISO(task.due, 1) } };
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
  const start = new Date(`${task.due}T${task.time}:00`);
  const end = new Date(start.getTime() + (task.durationMinutes || 30) * 60_000);
  const localDateTime = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00`;
  return { summary: task.title, description, start: { dateTime: localDateTime(start), timeZone }, end: { dateTime: localDateTime(end), timeZone } };
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const ACTION_VERBS = ["revisar", "llamar", "comprar", "enviar", "hacer", "pedir", "reservar", "recoger", "programar", "preparar", "pagar", "escribir", "llevar", "buscar", "limpiar", "terminar"];

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const saved = row[rightIndex];
      row[rightIndex] = Math.min(row[rightIndex] + 1, row[rightIndex - 1] + 1, previous + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[right.length];
}

function correctLeadingAction(text: string) {
  const match = text.match(/^([\p{L}]+)/u);
  if (!match) return text;
  const heard = match[1].toLocaleLowerCase("es");
  const candidate = ACTION_VERBS.map((verb) => ({ verb, distance: editDistance(heard, verb) })).sort((a, b) => a.distance - b.distance)[0];
  return candidate && candidate.distance === 1 ? `${candidate.verb}${text.slice(match[1].length)}` : text;
}

function parseDate(text: string): string | undefined {
  const lower = text.toLocaleLowerCase("es").replace(/\bestá(?=\s+(?:mañana|tarde|noche))/g, "esta");
  if (/\b(?:esta|por la)\s+(?:mañana|tarde|noche)\b/.test(lower)) return todayISO();
  const inDays = lower.match(/\bdentro de (\d{1,2}) días?\b/);
  if (inDays) return addDaysISO(Number(inDays[1]));
  if (/\b(?:la )?(?:próxima semana|semana que viene)\b/.test(lower)) {
    const currentDay = new Date().getDay();
    return addDaysISO((8 - currentDay) % 7 || 7);
  }
  if (/\bpasado mañana\b/.test(lower)) return addDaysISO(2);
  if (/\bmañana\b/.test(lower)) return addDaysISO(1);
  if (/\bhoy\b/.test(lower)) return todayISO();
  const weekDays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const index = weekDays.findIndex((day) => lower.includes(day));
  if (index >= 0) {
    const d = new Date();
    let delta = (index - d.getDay() + 7) % 7;
    if (delta === 0 && !lower.includes("hoy")) delta = 7;
    return addDaysISO(delta);
  }
  const numeric = lower.match(/\b(?:el\s+)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : new Date().getFullYear();
    return `${year}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const written = lower.match(/\b(?:el\s+)?(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+(\d{4}))?\b/);
  if (written) {
    const month = months.indexOf(written[2]);
    if (month >= 0) {
      let year = written[3] ? Number(written[3]) : new Date().getFullYear();
      const candidate = `${year}-${String(month + 1).padStart(2, "0")}-${written[1].padStart(2, "0")}`;
      if (!written[3] && candidate < todayISO()) year += 1;
      return `${year}-${String(month + 1).padStart(2, "0")}-${written[1].padStart(2, "0")}`;
    }
  }
  return undefined;
}

function parseTime(text: string): string | undefined {
  const numberWords: Record<string, string> = { una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10", once: "11", doce: "12" };
  const lower = text.toLocaleLowerCase("es").replace(/\b(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/g, (word) => numberWords[word]);
  const match = lower.match(/\b(?:a\s+las?|sobre\s+las?)\s*(\d{1,2})(?::(\d{2}))?(?:\s*(?:h|horas?))?(?:\s+de la\s+(mañana|tarde|noche))?\b/);
  if (!match) return undefined;
  let hour = Number(match[1]);
  if ((match[3] === "tarde" || match[3] === "noche") && hour < 12) hour += 12;
  if (match[3] === "mañana" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${(match[2] || "00").padStart(2, "0")}`;
}

function parsePriority(text: string): Priority | undefined {
  if (/prioridad\s+(?:alta|uno|1)|\bp1\b/i.test(text)) return 1;
  if (/prioridad\s+(?:media|dos|2)|\bp2\b/i.test(text)) return 2;
  if (/prioridad\s+(?:baja|tres|3)|\bp3\b/i.test(text)) return 3;
  if (/prioridad\s+(?:ninguna|cuatro|4)|\bp4\b/i.test(text)) return 4;
  return undefined;
}

export function parseThoughts(input: string): Task[] {
  const normalized = input
    .replace(/\bdel(?=[áéíóú])/gi, "de L")
    .replace(/,?\s+que\s+(?=(?:est[aá]|por la)\s+(?:mañana|tarde|noche)\b)/gi, " ")
    .replace(/\ben realidad\s*,?\s*mejor\b/gi, "en realidad")
    .replace(/\s+(?:y\s+)?también\s+/gi, ". ")
    .replace(/\s+(?:después|luego|además)\s+/gi, ". ")
    .replace(/[,\s]+(?=(?:en realidad|quise decir|quiero decir|no,?\s+mejor|mejor)\b)/gi, ". ")
    .replace(/(?:,\s*(?:y\s+)?|\s+y\s+)(?=(?:tengo que|necesito|quiero|hay que|llamar|comprar|enviar|revisar|hacer|pedir|reservar|recoger|programar|preparar|pagar|escribir|llevar|buscar|limpiar|terminar)\b)/gi, ". ");
  const parts = normalized
    .split(/[.\n;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);

  const tasks: Task[] = [];
  for (const original of parts) {
    const lower = original.toLocaleLowerCase("es");
    if (/^(elimina|eliminar|borra|borrar|olvida|olvidar) (eso|la última|lo último)/.test(lower)) {
      tasks.pop();
      continue;
    }
    const namedDeletion = original.match(/^(?:elimina|eliminar|borra|borrar|olvida|olvidar)(?:\s+la tarea de)?\s+(.+)$/i);
    if (namedDeletion) {
      const query = namedDeletion[1].toLocaleLowerCase("es");
      const index = tasks.findLastIndex((task) => task.title.toLocaleLowerCase("es").includes(query));
      if (index >= 0) tasks.splice(index, 1);
      continue;
    }
    const correction = original.match(/(?:en realidad|quise decir|quiero decir|no,?\s+mejor|mejor)[,:]?\s*(.+)$/i);
    if (correction && tasks.length) {
      const instruction = correction[1];
      const previous = tasks[tasks.length - 1];
      const due = parseDate(instruction);
      const time = parseTime(instruction);
      const priority = parsePriority(instruction);
      const project = instruction.match(/\b(?:en|para|al)\s+(?:el\s+)?proyecto\s+[“\"]?([^,.@]+)[”\"]?/i)?.[1]?.trim();
      const hasMetadata = Boolean(due || time || priority || project);
      if (hasMetadata) {
        tasks[tasks.length - 1] = { ...previous, due: due || previous.due, time: time || previous.time, priority: priority || previous.priority, project: project || previous.project };
      } else {
        const replacement = parseThoughts(instruction);
        if (replacement[0]) tasks[tasks.length - 1] = { ...replacement[0], id: previous.id };
      }
      continue;
    }

    const projectMatch = original.match(/\b(?:en|para|al)\s+(?:el\s+)?proyecto\s+[“\"]?([^,.@]+)[”\"]?/i);
    const knownProject = PROJECTS.find((project) => lower.includes(`proyecto ${project.toLocaleLowerCase("es")}`));
    const labels = [...original.matchAll(/@([\p{L}\d_-]+)/gu)].map((match) => match[1]);
    const recurringMatch = original.match(/\b(cada\s+(?:día|semana|mes|lunes|martes|miércoles|jueves|viernes|sábado|domingo)|todos?\s+los?\s+\p{L}+)\b/iu);
    const priority: Priority = parsePriority(original) || 4;
    const calendarRequested = /(?:a(?:ñ|n)[aá]d(?:e|elo|ela)|agrega|guarda|pon)(?:r)?(?:lo|la)?\s+(?:en|al)\s+(?:mi\s+)?(?:google\s+)?calendario|\ben\s+(?:mi\s+)?(?:google\s+)?calendar\b/i.test(original);

    let title = correctLeadingAction(original)
      .replace(/^(?:necesito|tengo que|quiero|hay que|apunta|anota|recuérdame)\s+/i, "")
      .replace(/\b(?:hoy|mañana|pasado mañana)\b/gi, "")
      .replace(/\b(?:est[aá]|por la)\s+(?:mañana|tarde|noche)\b/gi, "")
      .replace(/\bdentro de \d{1,2} días?\b/gi, "")
      .replace(/\b(?:la )?(?:próxima semana|semana que viene)\b/gi, "")
      .replace(/\b(?:el\s+)?(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/gi, "")
      .replace(/\b(?:el\s+)?\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/gi, "")
      .replace(/\b(?:el\s+)?\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+\d{4})?\b/gi, "")
      .replace(/\b(?:a\s+las?|sobre\s+las?)\s*\d{1,2}(?::\d{2})?\s*(?:h|horas?)?(?:\s+de la\s+(?:mañana|tarde|noche))?\b/gi, "")
      .replace(/\b(?:a\s+las?|sobre\s+las?)\s*(?:una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s*(?:h|horas?)?(?:\s+de la\s+(?:mañana|tarde|noche))?\b/gi, "")
      .replace(/\bde la\s+(?:mañana|tarde|noche)\b/gi, "")
      .replace(/\b(?:con\s+)?prioridad\s+(?:alta|media|baja|uno|dos|tres|1|2|3)\b|\bp[1-4]\b/gi, "")
      .replace(/\b(?:en|para|al)\s+(?:el\s+)?proyecto\s+[“\"]?[^,.@]+[”\"]?/gi, "")
      .replace(/\b(?:cada\s+(?:día|semana|mes|lunes|martes|miércoles|jueves|viernes|sábado|domingo)|todos?\s+los?\s+\p{L}+)\b/giu, "")
      .replace(/\b(?:y\s+)?(?:a(?:ñ|n)[aá]d(?:e|elo|ela)|agrega|guarda|pon)(?:r)?(?:lo|la)?\s+(?:en|al)\s+(?:mi\s+)?(?:google\s+)?calendario\b/giu, "")
      .replace(/\ben\s+(?:mi\s+)?google\s+calendar\b/giu, "")
      .replace(/@[\p{L}\d_-]+/gu, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[,\s]+|[,\s]+$/g, "");

    title = title
      .replace(/^(?:llamaré|llamará|llamaremos)(?=\s|$)/i, "llamar")
      .replace(/^(?:compraré|comprará|compraremos)(?=\s|$)/i, "comprar")
      .replace(/^(?:enviaré|enviará|enviaremos)(?=\s|$)/i, "enviar")
      .replace(/^(?:revisaré|revisará|revisaremos)(?=\s|$)/i, "revisar")
      .replace(/^(?:haré|hará|haremos)(?=\s|$)/i, "hacer")
      .replace(/^llamar\s+(?!a\b)(?=[A-ZÁÉÍÓÚÑ])/i, "llamar a ");
    if (!title) title = original;
    title = title.charAt(0).toUpperCase() + title.slice(1);
    tasks.push({
      id: uid(),
      title,
      project: knownProject || projectMatch?.[1]?.trim() || "Bandeja de entrada",
      due: parseDate(original),
      time: parseTime(original),
      recurring: recurringMatch?.[1],
      priority,
      labels,
      completed: false,
      createdAt: new Date().toISOString(),
      calendarRequested,
      durationMinutes: 30,
    });
  }
  return tasks;
}

function relativeDate(date?: string) {
  if (!date) return "Sin fecha";
  if (date === todayISO()) return "Hoy";
  if (date === addDaysISO(1)) return "Mañana";
  return new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(seedTasks);
  const [projects, setProjects] = useState<string[]>(PROJECTS);
  const [view, setView] = useState<View>("today");
  const [hydrated, setHydrated] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showRamble, setShowRamble] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showOrganizer, setShowOrganizer] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleBusyTaskId, setGoogleBusyTaskId] = useState<string | null>(null);
  const [googleMessage, setGoogleMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [newProject, setNewProject] = useState("");
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [thoughts, setThoughts] = useState("");
  const [preview, setPreview] = useState<Task[]>([]);
  const [editingPreviewId, setEditingPreviewId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [micMessage, setMicMessage] = useState("");
  const [transcriptionStatus, setTranscriptionStatus] = useState<"idle" | "loading" | "transcribing">("idle");
  const [modelProgress, setModelProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(48000);
  const transcriberRef = useRef<Promise<any> | null>(null);
  const googleClientIdRef = useRef("");
  const googleTokenClientRef = useRef<GoogleTokenClient | null>(null);
  const googleTokenRef = useRef<{ token: string; expiresAt: number } | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);
    const captureInstallPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    const saved = localStorage.getItem(STORAGE_KEY);
    let savedProjects: string[] = [];
    try {
      const parsedProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]");
      if (Array.isArray(parsedProjects)) savedProjects = parsedProjects;
    } catch { /* keep starter projects */ }
    setProjects(Array.from(new Set([...PROJECTS, ...savedProjects])));
    if (saved) {
      try {
        const savedTasks: Task[] = JSON.parse(saved);
        setTasks(savedTasks);
        const taskProjects = savedTasks.map((task) => task.project).filter(Boolean);
        setProjects(Array.from(new Set([...PROJECTS, ...(Array.isArray(savedProjects) ? savedProjects : []), ...taskProjects])));
      } catch { /* keep starter tasks */ }
    }
    setHydrated(true);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js?v=13", { updateViaCache: "none" }).then((registration) => registration.update()).catch(() => undefined);
    const action = new URLSearchParams(window.location.search).get("action");
    if (action === "ramble") window.setTimeout(openRamble, 0);
    if (action === "add") window.setTimeout(() => setShowComposer(true), 0);
    fetch("/api/google-config", { cache: "no-store" }).then((response) => response.json()).then((config) => { setGoogleConfigured(Boolean(config.configured)); googleClientIdRef.current = config.clientId || ""; }).catch(() => setGoogleConfigured(false));
    return () => window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  }, [projects, hydrated]);

  const visibleTasks = useMemo(() => {
    const active = tasks.filter((task) => !task.completed);
    let result: Task[];
    const hasOrganizationFilter = Boolean(searchQuery.trim() || selectedProject || selectedLabel);
    if (view === "completed") result = tasks.filter((task) => task.completed).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
    else if (hasOrganizationFilter) result = active;
    else if (view === "today") result = active.filter((task) => task.due === todayISO());
    else if (view === "upcoming") result = active.filter((task) => task.due && task.due >= todayISO()).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
    else result = active.filter((task) => task.project === "Bandeja de entrada");
    if (selectedProject) result = result.filter((task) => task.project === selectedProject);
    if (selectedLabel) result = result.filter((task) => task.labels.includes(selectedLabel));
    const query = searchQuery.trim().toLocaleLowerCase("es");
    if (query) result = result.filter((task) => [task.title, task.description || "", task.project, ...task.labels].join(" ").toLocaleLowerCase("es").includes(query));
    return result;
  }, [tasks, view, searchQuery, selectedProject, selectedLabel]);

  const availableLabels = useMemo(() => Array.from(new Set(tasks.flatMap((task) => task.labels))).sort((a, b) => a.localeCompare(b, "es")), [tasks]);
  const calendarTasks = useMemo(() => tasks.filter((task) => !task.completed && task.due).sort((a, b) => `${a.due}${a.time || ""}`.localeCompare(`${b.due}${b.time || ""}`)), [tasks]);

  const counts = {
    inbox: tasks.filter((task) => !task.completed && task.project === "Bandeja de entrada").length,
    today: tasks.filter((task) => !task.completed && task.due === todayISO()).length,
    upcoming: tasks.filter((task) => !task.completed && task.due && task.due >= todayISO()).length,
  };

  function addQuickTask() {
    if (!quickTitle.trim()) return;
    const parsed = parseThoughts(quickTitle)[0];
    const task = parsed || { id: uid(), title: quickTitle.trim(), project: "Bandeja de entrada", priority: 4 as Priority, labels: [], completed: false, createdAt: new Date().toISOString() };
    setTasks((current) => [...current, selectedProject ? { ...task, project: selectedProject } : task]);
    setQuickTitle("");
    setShowComposer(false);
    flash("Tarea añadida");
  }

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  }

  async function installAndroidApp() {
    setShowMenu(false);
    if (!installPrompt) { setShowInstallHelp(true); return; }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") { setIsStandalone(true); flash("Brisa instalada"); }
    setInstallPrompt(null);
  }

  function loadGoogleIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-brisa-google="true"]');
      if (existing) { existing.addEventListener("load", () => resolve(), { once: true }); existing.addEventListener("error", () => reject(new Error("Google no respondió")), { once: true }); return; }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.brisaGoogle = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google no respondió"));
      document.head.appendChild(script);
    });
  }

  async function getGoogleToken() {
    const cached = googleTokenRef.current;
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    if (!googleClientIdRef.current) throw new Error("La conexión con Google aún no está configurada");
    await loadGoogleIdentity();
    return new Promise<string>((resolve, reject) => {
      const callback = (response: GoogleTokenResponse) => {
        if (!response.access_token) { reject(new Error(response.error_description || "No se autorizó Google Calendar")); return; }
        const value = { token: response.access_token, expiresAt: Date.now() + (response.expires_in || 3600) * 1000 };
        googleTokenRef.current = value;
        setGoogleConnected(true);
        setGoogleMessage("Google Calendar conectado durante esta sesión");
        resolve(value.token);
      };
      googleTokenClientRef.current = window.google!.accounts.oauth2.initTokenClient({ client_id: googleClientIdRef.current, scope: "https://www.googleapis.com/auth/calendar.events.owned", callback });
      googleTokenClientRef.current.requestAccessToken({ prompt: googleConnected ? "" : "consent" });
    });
  }

  async function connectGoogle() {
    setGoogleMessage("");
    try { await getGoogleToken(); } catch (error) { setGoogleConnected(false); setGoogleMessage(error instanceof Error ? error.message : "No se pudo conectar con Google"); }
  }

  function disconnectGoogle() {
    const token = googleTokenRef.current?.token;
    if (token && window.google?.accounts.oauth2) window.google.accounts.oauth2.revoke(token);
    googleTokenRef.current = null;
    setGoogleConnected(false);
    setGoogleMessage("Cuenta desconectada de este dispositivo");
  }

  async function syncTaskWithGoogle(task: Task) {
    const event = googleCalendarEvent(task);
    if (!event) { flash("Añade una fecha antes de sincronizar"); return false; }
    setGoogleBusyTaskId(task.id);
    setGoogleMessage("");
    try {
      const token = await getGoogleToken();
      const eventUrl = task.calendarEventId ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(task.calendarEventId)}` : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
      const response = await fetch(eventUrl, { method: task.calendarEventId ? "PATCH" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(event) });
      if (!response.ok) { if (response.status === 401) { googleTokenRef.current = null; setGoogleConnected(false); } throw new Error("Google Calendar no pudo guardar el evento"); }
      const saved = await response.json();
      updateTask(task.id, { calendarRequested: true, calendarEventId: saved.id || task.calendarEventId, calendarSyncedAt: new Date().toISOString(), calendarSyncState: "synced" });
      setGoogleMessage(task.calendarEventId ? "Evento actualizado en Google Calendar" : "Evento creado en Google Calendar");
      flash(task.calendarEventId ? "Evento actualizado en Calendar" : "Evento creado en Calendar");
      return true;
    } catch (error) {
      updateTask(task.id, { calendarSyncState: "error" });
      setGoogleMessage(error instanceof Error ? error.message : "No se pudo sincronizar");
      return false;
    } finally { setGoogleBusyTaskId(null); }
  }

  async function removeGoogleEvent(task: Task) {
    if (!task.calendarEventId) return true;
    try {
      const token = await getGoogleToken();
      const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(task.calendarEventId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error("Google Calendar no pudo eliminar el evento");
      return true;
    } catch (error) { setGoogleMessage(error instanceof Error ? error.message : "No se pudo eliminar el evento"); return false; }
  }

  async function toggleTask(id: string) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const completing = !task.completed;
    if (completing && task.calendarEventId) {
      setGoogleBusyTaskId(id);
      const removed = await removeGoogleEvent(task);
      setGoogleBusyTaskId(null);
      if (!removed) { flash("Conecta Google para retirar el evento"); return; }
    }
    setTasks((current) => current.map((item) => item.id === id ? { ...item, completed: completing, completedAt: completing ? new Date().toISOString() : undefined, ...(completing && item.calendarEventId ? { calendarEventId: undefined, calendarSyncedAt: undefined, calendarSyncState: undefined } : {}), ...(!completing && item.calendarRequested ? { calendarSyncState: "pending" as const } : {}) } : item));
    if (completing && task.calendarEventId) flash("Tarea completada y evento retirado");
  }

  function updateTask(id: string, changes: Partial<Task>) {
    const syncFields: Array<keyof Task> = ["title", "description", "due", "time", "durationMinutes", "recurring"];
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...changes, ...(task.calendarEventId && syncFields.some((field) => field in changes) ? { calendarSyncState: "pending" as const } : {}) } : task));
  }

  async function deleteTask(id: string) {
    const task = tasks.find((item) => item.id === id);
    if (task?.calendarEventId && !(await removeGoogleEvent(task))) { flash("No eliminé la tarea: falta borrar su evento"); return; }
    setTasks((current) => current.filter((task) => task.id !== id));
    setEditingTaskId(null);
    flash("Tarea eliminada");
  }

  function openInGoogleCalendar(task: Task) {
    const url = googleCalendarUrl(task);
    if (!url) { flash("Añade una fecha antes de abrir Calendar"); return; }
    window.open(url, "_blank", "noopener,noreferrer");
    updateTask(task.id, { calendarRequested: true, calendarOpenedAt: new Date().toISOString() });
    flash("Evento preparado; confirma Guardar en Google Calendar");
  }

  function handleCalendarAction(task: Task) {
    if (googleConfigured) void syncTaskWithGoogle(task);
    else openInGoogleCalendar(task);
  }

  function saveEditedTask(task: Task) {
    if (task.project.trim()) setProjects((current) => current.includes(task.project.trim()) ? current : [...current, task.project.trim()]);
    setEditingTaskId(null);
    if (task.calendarRequested && task.due) handleCalendarAction(task);
    else flash("Cambios guardados");
  }

  function clearOrganizationFilters() {
    setSearchQuery("");
    setSelectedProject(null);
    setSelectedLabel(null);
  }

  function changeView(nextView: View) {
    clearOrganizationFilters();
    setView(nextView);
  }

  function openProject(project: string) {
    setSearchQuery("");
    setSelectedLabel(null);
    setSelectedProject(project);
    setView("inbox");
    setShowMenu(false);
    setShowOrganizer(false);
  }

  function addProject() {
    const name = newProject.trim();
    if (!name || projects.some((project) => project.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) return;
    setProjects((current) => [...current, name]);
    setNewProject("");
    openProject(name);
    flash("Proyecto creado y abierto");
  }

  function saveProjectRename() {
    const oldName = renamingProject;
    const name = renameValue.trim();
    if (!oldName || !name || oldName === "Bandeja de entrada") return;
    if (projects.some((project) => project !== oldName && project.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) return;
    setProjects((current) => current.map((project) => project === oldName ? name : project));
    setTasks((current) => current.map((task) => task.project === oldName ? { ...task, project: name } : task));
    if (selectedProject === oldName) setSelectedProject(name);
    setRenamingProject(null);
    flash("Proyecto renombrado");
  }

  function deleteProject(project: string) {
    if (project === "Bandeja de entrada") return;
    setProjects((current) => current.filter((item) => item !== project));
    setTasks((current) => current.map((task) => task.project === project ? { ...task, project: "Bandeja de entrada" } : task));
    if (selectedProject === project) setSelectedProject(null);
    flash("Proyecto eliminado; sus tareas están en Bandeja");
  }

  function openRamble() {
    setShowMenu(false);
    setThoughts("");
    setPreview([]);
    setEditingPreviewId(null);
    setMicMessage("");
    setTranscriptionStatus("idle");
    setShowRamble(true);
  }

  async function startListening() {
    setMicMessage("");
    if (!window.isSecureContext) {
      setMicMessage("El micrófono solo funciona en una conexión segura o desde localhost.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicMessage("Esta vista no ofrece acceso al micrófono. Abre Brisa en Chrome o Edge para usar la voz.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      const audioContext = new AudioContext();
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      pcmChunksRef.current = [];
      sampleRateRef.current = audioContext.sampleRate;
      processor.onaudioprocess = (event) => {
        pcmChunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceNodeRef.current = source;
      processorRef.current = processor;
      silentGainRef.current = silentGain;
      setListening(true);
      setMicMessage("Micrófono activo. Pulsa Parar y transcribir cuando termines.");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      setMicMessage(name === "NotAllowedError"
        ? "El micrófono está bloqueado. Permítelo en los ajustes del sitio y vuelve a intentarlo."
        : "No he podido acceder al micrófono. Comprueba que no lo esté usando otra aplicación.");
      return;
    }
  }

  function stopListening() {
    processorRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    processorRef.current = null;
    sourceNodeRef.current = null;
    silentGainRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setListening(false);
    const audio = mergeAndResample(chunks, sampleRateRef.current, 16000);
    if (audio.length < 4000) {
      setMicMessage("La grabación ha sido demasiado corta o no contenía audio. Habla durante al menos un segundo.");
      return;
    }
    void transcribeWithGroq(audio);
  }

  function mergeAndResample(chunks: Float32Array[], inputRate: number, outputRate: number) {
    const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    if (inputRate === outputRate) return merged;
    const output = new Float32Array(Math.max(1, Math.floor(merged.length * outputRate / inputRate)));
    const ratio = inputRate / outputRate;
    for (let index = 0; index < output.length; index += 1) {
      const position = index * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, merged.length - 1);
      const mix = position - left;
      output[index] = merged[left] * (1 - mix) + merged[right] * mix;
    }
    return output;
  }

  function encodeWav(audio: Float32Array, sampleRate: number) {
    const buffer = new ArrayBuffer(44 + audio.length * 2);
    const view = new DataView(buffer);
    const write = (offset: number, value: string) => Array.from(value).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    write(0, "RIFF"); view.setUint32(4, 36 + audio.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, audio.length * 2, true);
    for (let index = 0; index < audio.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, audio[index]));
      view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function finishTranscription(text: string, provider: "groq" | "local") {
    const combinedThoughts = [thoughts.trim(), text].filter(Boolean).join(". ");
    const parsedTasks = parseThoughts(combinedThoughts).map((task) => selectedProject && task.project === "Bandeja de entrada" ? { ...task, project: selectedProject } : task);
    setThoughts(combinedThoughts);
    setPreview(parsedTasks);
    setTranscriptionStatus("idle");
    const isDeletion = /\b(?:borra|borrar|elimina|eliminar|olvida|olvidar)\b/i.test(text);
    const isCorrection = /\b(?:en realidad|quise decir|quiero decir|mejor)\b/i.test(text);
    const removed = preview.filter((oldTask) => !parsedTasks.some((newTask) => newTask.id === oldTask.id || newTask.title === oldTask.title));
    if (isDeletion && parsedTasks.length < preview.length) {
      setMicMessage(`Orden aplicada: ${removed.length ? `he eliminado “${removed.map((task) => task.title).join("”, “")}”` : "he eliminado la tarea indicada"}.`);
    } else if (isCorrection) {
      setMicMessage("Corrección aplicada. Las tarjetas muestran el resultado actualizado.");
    } else {
      setMicMessage(text ? `${provider === "groq" ? "Transcripción precisa con Groq" : "Transcripción local"} terminada. Revisa las tarjetas antes de añadirlas.` : "No he detectado voz clara. Inténtalo de nuevo más cerca del micrófono.");
    }
  }

  async function transcribeWithGroq(audio: Float32Array) {
    try {
      setTranscriptionStatus("transcribing");
      setMicMessage("Transcribiendo con Groq…");
      const form = new FormData();
      form.append("audio", encodeWav(audio, 16000), "brisa.wav");
      form.append("context", Array.from(new Set([...projects, ...availableLabels])).join(", "));
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const payload = await response.json() as { text?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Groq no respondió correctamente.");
      finishTranscription(payload.text || "", "groq");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "error desconocido";
      setMicMessage(`${detail} Usando transcripción local…`);
      await transcribeLocally(audio);
    }
  }

  async function transcribeLocally(audio: Float32Array) {
    try {
      setTranscriptionStatus("loading");
      setModelProgress(0);
      setMicMessage("Preparando el modelo local preciso. La primera vez tardará más mientras se descarga; después quedará guardado en el navegador.");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
      if (!transcriberRef.current) {
        transcriberRef.current = (async () => {
          const { env, pipeline } = await import("@huggingface/transformers");
          env.allowLocalModels = false;
          env.allowRemoteModels = true;
          env.useBrowserCache = true;
          (env.backends.onnx.wasm as { numThreads?: number; proxy?: boolean }).numThreads = 1;
          (env.backends.onnx.wasm as { numThreads?: number; proxy?: boolean }).proxy = false;
          return pipeline("automatic-speech-recognition", "onnx-community/whisper-small", {
            dtype: "q8",
            device: "wasm",
            progress_callback: (progress: { progress?: number }) => {
              if (typeof progress.progress === "number") setModelProgress(Math.round(progress.progress));
            },
          });
        })();
      }
      const transcriber = await transcriberRef.current;
      setTranscriptionStatus("transcribing");
      setMicMessage("Transcribiendo dentro de tu dispositivo…");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
      const result = await transcriber(audio, {
        language: "spanish",
        task: "transcribe",
        do_sample: false,
        num_beams: 3,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = String(Array.isArray(result) ? result.map((item: { text?: string }) => item.text || "").join(" ") : result.text || "").trim();
      finishTranscription(text, "local");
    } catch (error) {
      setTranscriptionStatus("idle");
      transcriberRef.current = null;
      const detail = error instanceof Error ? error.message : "error desconocido";
      setMicMessage(`No se pudo iniciar Whisper: ${detail}`);
    }
  }

  function updateThoughts(value: string) {
    setThoughts(value);
    setPreview(parseThoughts(value).map((task) => selectedProject && task.project === "Bandeja de entrada" ? { ...task, project: selectedProject } : task));
    setEditingPreviewId(null);
  }

  function updatePreviewTask(id: string, changes: Partial<Task>) {
    setPreview((current) => current.map((task) => task.id === id ? { ...task, ...changes } : task));
  }

  function confirmRamble() {
    if (!preview.length) return;
    const requested = preview.filter((task) => task.calendarRequested && task.due);
    const firstRequested = requested[0];
    const savedPreview = preview.map((task) => task.id === firstRequested?.id && !googleConfigured ? { ...task, calendarOpenedAt: new Date().toISOString() } : task);
    if (firstRequested) {
      if (googleConfigured) window.setTimeout(() => void syncTaskWithGoogle(firstRequested), 0);
      else window.open(googleCalendarUrl(firstRequested), "_blank", "noopener,noreferrer");
    }
    setTasks((current) => [...current, ...savedPreview]);
    setProjects((current) => Array.from(new Set([...current, ...preview.map((task) => task.project).filter(Boolean)])));
    setShowRamble(false);
    setView("inbox");
    flash(firstRequested ? (googleConfigured ? "Tarea añadida; conectando con Calendar" : "Tarea añadida; confirma el evento en Calendar") : `${preview.length} ${preview.length === 1 ? "tarea añadida" : "tareas añadidas"}`);
  }

  function exportBackup() {
    const backup = { app: "Brisa", version: 2, exportedAt: new Date().toISOString(), projects, tasks };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `brisa-copia-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowMenu(false);
    flash("Copia lista para guardar o compartir");
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      if (!Array.isArray(backup.tasks)) throw new Error("Invalid backup");
      setTasks(backup.tasks);
      if (Array.isArray(backup.projects)) setProjects(Array.from(new Set([...PROJECTS, ...backup.projects])) as string[]);
      flash("Copia restaurada");
    } catch { flash("No reconozco esta copia"); }
    event.target.value = "";
    setShowMenu(false);
  }

  const viewNames: Record<View, string> = { inbox: "Bandeja", today: "Hoy", upcoming: "Próximas", completed: "Completadas" };
  const currentTitle = selectedProject || (selectedLabel ? `@${selectedLabel}` : searchQuery ? "Resultados" : viewNames[view]);
  const currentEyebrow = selectedProject ? "Proyecto" : selectedLabel ? "Etiqueta" : searchQuery ? "Búsqueda" : view === "today" ? new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(new Date()) : "Tu espacio";

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" aria-label="Ir a Hoy" onClick={() => setView("today")}><span className="brand-mark">B</span><span>Brisa</span></button>
        <div className="top-actions">
          <button className="icon-btn" onClick={openRamble} aria-label="Abrir Descarga mental"><span className="wave-mini">≋</span></button>
          <button className="icon-btn" onClick={() => setShowMenu((value) => !value)} aria-label="Abrir menú">•••</button>
        </div>
        {showMenu && (
          <div className="overflow-menu">
            {!isStandalone && <button onClick={installAndroidApp}><span>⇩</span> Instalar en Android</button>}
            <button onClick={() => { setShowOrganizer(true); setShowMenu(false); }}><span>⌕</span> Organizar y buscar</button>
            <button onClick={() => { setShowCalendar(true); setShowMenu(false); }}><span>▦</span> Google Calendar</button>
            <p className="menu-section-title">Proyectos</p>
            {projects.map((project) => <button className={selectedProject === project ? "menu-project active" : "menu-project"} key={project} onClick={() => openProject(project)}><i /><span>{project}</span><b>{tasks.filter((task) => !task.completed && task.project === project).length}</b></button>)}
            <div className="menu-divider" />
            <button onClick={exportBackup}><span>⇩</span> Crear copia</button>
            <button onClick={() => importRef.current?.click()}><span>⇧</span> Restaurar copia</button>
            <input ref={importRef} type="file" accept="application/json" onChange={importBackup} hidden />
          </div>
        )}
      </header>

      <section className="content">
        <div className="view-heading">
          <div>
            <p className="eyebrow">{currentEyebrow}</p>
            <h1>{currentTitle}</h1>
          </div>
          <span className="task-total">{visibleTasks.length}</span>
        </div>
        {(searchQuery || selectedProject || selectedLabel) && <div className="active-filters"><span>{searchQuery && `“${searchQuery}”`}{selectedProject && ` · ${selectedProject}`}{selectedLabel && ` · @${selectedLabel}`}</span><button onClick={clearOrganizationFilters}>Quitar filtros</button></div>}

        <div className="task-list">
          {visibleTasks.map((task) => (
            <article className={`task-card p${task.priority}`} key={task.id}>
              <button className="check" onClick={() => void toggleTask(task.id)} disabled={googleBusyTaskId === task.id} aria-label={task.completed ? `Reabrir ${task.title}` : `Completar ${task.title}`}><span>{task.completed ? "✓" : ""}</span></button>
              <div className="task-body">
                <h2 className={task.completed ? "done" : ""}>{task.title}</h2>
                {task.description && <p className="description">{task.description}</p>}
                <div className="task-meta">
                  {task.due && <span className={task.due === todayISO() ? "due-today" : ""}>◷ {relativeDate(task.due)}{task.time ? ` · ${task.time}` : ""}</span>}
                  {task.recurring && <span>↻ {task.recurring}</span>}
                  {task.due && <button className={`calendar-chip ${task.calendarEventId ? "synced" : task.calendarOpenedAt ? "opened" : ""}`} onClick={() => handleCalendarAction(task)} disabled={googleBusyTaskId === task.id}>▦ {googleBusyTaskId === task.id ? "Sincronizando…" : task.calendarEventId ? (task.calendarSyncState === "pending" ? "Actualizar Calendar" : "Sincronizada") : task.calendarOpenedAt ? "Abrir de nuevo" : task.calendarRequested ? "Añadir a Calendar" : "Calendar"}</button>}
                  <span className="project-dot"><i />{task.project}</span>
                  {task.labels.map((label) => <span key={label}>@{label}</span>)}
                </div>
              </div>
              <button className="task-edit-btn" onClick={() => setEditingTaskId(task.id)} aria-label={`Editar ${task.title}`}><span>✎</span> Editar</button>
            </article>
          ))}
          {!visibleTasks.length && (
            <div className="empty-state">
              <div className="empty-orbit"><span>✓</span></div>
              <h2>{selectedProject ? `${selectedProject} está vacío` : view === "completed" ? "Aún no hay tareas completadas" : "Todo despejado"}</h2>
              <p>{selectedProject ? "Añade aquí la primera tarea de este proyecto." : view === "completed" ? "Tus pequeños avances aparecerán aquí." : "Disfruta del espacio o captura lo siguiente que tengas en mente."}</p>
              {selectedProject && <div className="empty-project-actions"><button className="empty-voice" onClick={openRamble}><span>≋</span> Hablar</button><button className="empty-add" onClick={() => setShowComposer(true)}>＋ Escribir</button></div>}
            </div>
          )}
        </div>
      </section>

      <button className="ramble-fab" onClick={openRamble} aria-label="Descarga mental"><span className="pulse" /><span className="wave">≋</span></button>
      <button className="add-fab" onClick={() => setShowComposer(true)} aria-label="Añadir tarea">+</button>

      <nav className="bottom-nav" aria-label="Navegación principal">
        <button className={view === "inbox" && !selectedProject && !selectedLabel && !searchQuery ? "active" : ""} onClick={() => changeView("inbox")}><span className="nav-icon">▱</span><span>Bandeja</span>{counts.inbox > 0 && <b>{counts.inbox}</b>}</button>
        <button className={view === "today" && !selectedProject && !selectedLabel && !searchQuery ? "active" : ""} onClick={() => changeView("today")}><span className="calendar-icon">{new Date().getDate()}</span><span>Hoy</span>{counts.today > 0 && <b>{counts.today}</b>}</button>
        <button className={view === "upcoming" && !selectedProject && !selectedLabel && !searchQuery ? "active" : ""} onClick={() => changeView("upcoming")}><span className="nav-icon">⌁</span><span>Próximas</span></button>
        <button className={view === "completed" && !selectedProject && !selectedLabel && !searchQuery ? "active" : ""} onClick={() => changeView("completed")}><span className="nav-icon">✓</span><span>Hechas</span></button>
      </nav>

      {showInstallHelp && (
        <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowInstallHelp(false)}>
          <section className="install-sheet sheet">
            <div className="sheet-handle" />
            <div className="install-icon"><img src="/brisa-192.png" alt="" /></div>
            <p className="eyebrow">Android</p><h2>Instalar Brisa</h2>
            <p>Abre el menú de Brave o Chrome y pulsa <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</p>
            <p>Después podrás mantener pulsado el icono de Brisa para abrir directamente “Hablar” o “Añadir tarea”.</p>
            <button className="confirm-btn" onClick={() => setShowInstallHelp(false)}>Entendido</button>
          </section>
        </div>
      )}

      {showOrganizer && (
        <div className="sheet-backdrop organizer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowOrganizer(false)}>
          <section className="organizer sheet" aria-label="Organizar y buscar">
            <div className="sheet-handle" />
            <div className="organizer-heading"><div><p>Tu espacio</p><h2>Organizar y buscar</h2></div><button onClick={() => setShowOrganizer(false)} aria-label="Cerrar">×</button></div>
            <label className="search-field"><span>⌕</span><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Buscar tareas…" /><button onClick={() => setSearchQuery("")} aria-label="Limpiar búsqueda">{searchQuery ? "×" : ""}</button></label>
            <div className="organizer-section"><div className="section-title"><h3>Proyectos</h3><span>{projects.length}</span></div>
              <div className="project-list">{projects.map((project) => renamingProject === project ? (
                <div className="rename-project" key={project}><input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveProjectRename()} /><button onClick={saveProjectRename}>Guardar</button><button onClick={() => setRenamingProject(null)}>Cancelar</button></div>
              ) : (
                <div className={selectedProject === project ? "project-row selected" : "project-row"} key={project}><button className="project-filter" onClick={() => openProject(project)}><i /> <span>{project}</span><b>{tasks.filter((task) => !task.completed && task.project === project).length}</b></button>{project !== "Bandeja de entrada" && <><button aria-label={`Renombrar ${project}`} onClick={() => { setRenamingProject(project); setRenameValue(project); }}>✎</button><button aria-label={`Eliminar ${project}`} onClick={() => deleteProject(project)}>×</button></>}</div>
              ))}</div>
              <div className="new-project"><input value={newProject} onChange={(event) => setNewProject(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addProject()} placeholder="Nuevo proyecto" /><button onClick={addProject} disabled={!newProject.trim()}>Añadir</button></div>
            </div>
            <div className="organizer-section"><div className="section-title"><h3>Etiquetas</h3><span>{availableLabels.length}</span></div><div className="label-cloud">{availableLabels.length ? availableLabels.map((label) => <button className={selectedLabel === label ? "selected" : ""} key={label} onClick={() => { setSelectedLabel((current) => current === label ? null : label); setSelectedProject(null); }}>@{label}</button>) : <p>Añade etiquetas desde el editor de una tarea.</p>}</div></div>
            <div className="organizer-footer"><button onClick={clearOrganizationFilters}>Limpiar filtros</button><button className="confirm-btn" onClick={() => setShowOrganizer(false)}>Ver {visibleTasks.length} {visibleTasks.length === 1 ? "tarea" : "tareas"}</button></div>
          </section>
        </div>
      )}

      {showCalendar && (
        <div className="sheet-backdrop calendar-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowCalendar(false)}>
          <section className="calendar-sheet sheet" aria-label="Tareas para Google Calendar">
            <div className="sheet-handle" />
            <div className="calendar-heading"><div><p>Planificación</p><h2>Google Calendar</h2></div><button onClick={() => setShowCalendar(false)} aria-label="Cerrar">×</button></div>
            <div className={`google-connection ${googleConnected ? "connected" : ""}`}><div><span>{googleConnected ? "✓" : "G"}</span><div><strong>{googleConnected ? "Google Calendar conectado" : googleConfigured ? "Conecta Google Calendar" : "Conexión automática pendiente"}</strong><small>{googleConnected ? "Brisa puede crear y actualizar tus eventos" : googleConfigured ? "Autoriza únicamente la gestión de eventos" : "Mientras tanto puedes seguir abriendo eventos preparados"}</small></div></div>{googleConfigured && <button onClick={googleConnected ? disconnectGoogle : connectGoogle}>{googleConnected ? "Desconectar" : "Conectar"}</button>}</div>
            {googleMessage && <p className="google-message" role="status">{googleMessage}</p>}
            <div className="calendar-explainer"><span>▦</span><p>{googleConfigured ? "Las tareas sincronizadas se crean en tu calendario principal. Si cambias su fecha, hora o título, Brisa te avisará para actualizar el evento." : <>Brisa abre cada evento con el nombre, la fecha y la hora preparados. Solo tendrás que pulsar <strong>Guardar</strong> en Google Calendar.</>}</p></div>
            <div className="calendar-list">
              {calendarTasks.map((task) => <article key={task.id}><div><h3>{task.title}</h3><p>{relativeDate(task.due)}{task.time ? ` · ${task.time}` : " · Todo el día"} · {task.project}{task.calendarEventId ? task.calendarSyncState === "pending" ? " · Cambios pendientes" : " · Sincronizada" : ""}</p></div><button className={task.calendarEventId ? "synced" : task.calendarOpenedAt ? "opened" : ""} onClick={() => handleCalendarAction(task)} disabled={googleBusyTaskId === task.id}>{googleBusyTaskId === task.id ? "Guardando…" : task.calendarEventId ? task.calendarSyncState === "pending" ? "Actualizar" : "Sincronizada" : task.calendarOpenedAt ? "Abrir de nuevo" : "Añadir"}</button></article>)}
              {!calendarTasks.length && <div className="calendar-empty"><span>◷</span><h3>No hay tareas fechadas</h3><p>Añade una fecha a una tarea y aparecerá aquí.</p></div>}
            </div>
            <p className="calendar-footnote">Brisa solo solicita permiso para gestionar eventos de calendarios que te pertenecen. Puedes desconectarla en cualquier momento.</p>
          </section>
        </div>
      )}

      {showComposer && (
        <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowComposer(false)}>
          <section className="composer sheet">
            <div className="sheet-handle" />
            <label htmlFor="quick-task">¿Qué necesitas hacer?</label>
            <textarea id="quick-task" autoFocus value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="Ej. Llamar a Marta mañana a las 10 p1" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); addQuickTask(); } }} />
            <div className="composer-tools"><span>{selectedProject ? `Se añadirá a ${selectedProject}` : "Entiendo fechas, horas, proyectos y prioridades"}</span><button onClick={addQuickTask} disabled={!quickTitle.trim()}>Añadir</button></div>
          </section>
        </div>
      )}

      {editingTaskId && (() => {
        const task = tasks.find((item) => item.id === editingTaskId);
        if (!task) return null;
        return (
          <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditingTaskId(null)}>
            <section className="task-editor sheet" aria-label={`Editar ${task.title}`}>
              <div className="sheet-handle" />
              <div className="editor-heading"><div><p>Editar tarea</p><h2>{task.title}</h2></div><button onClick={() => setEditingTaskId(null)} aria-label="Cerrar editor">×</button></div>
              <label className="editor-title">Nombre<input autoFocus value={task.title} onChange={(event) => updateTask(task.id, { title: event.target.value })} /></label>
              <div className="editor-grid">
                <label>Fecha<input type="date" value={task.due || ""} onChange={(event) => updateTask(task.id, { due: event.target.value || undefined })} /></label>
                <label>Hora<input type="time" value={task.time || ""} onChange={(event) => updateTask(task.id, { time: event.target.value || undefined })} /></label>
                <label>Prioridad<select value={task.priority} onChange={(event) => updateTask(task.id, { priority: Number(event.target.value) as Priority })}><option value="4">Normal</option><option value="1">Alta · P1</option><option value="2">Media · P2</option><option value="3">Baja · P3</option></select></label>
                <label>Proyecto<input list="saved-task-projects" value={task.project} onChange={(event) => updateTask(task.id, { project: event.target.value || "Bandeja de entrada" })} /></label>
                <label className="labels-field">Etiquetas<input value={task.labels.join(", ")} placeholder="casa, llamadas, urgente" onChange={(event) => updateTask(task.id, { labels: event.target.value.split(",").map((label) => label.trim().replace(/^@/, "")).filter(Boolean) })} /></label>
              </div>
              <div className={`calendar-option ${task.calendarRequested ? "selected" : ""}`}><div><span>▦</span><div><strong>Google Calendar</strong><small>{task.due ? "Abrir el evento preparado al guardar" : "Añade una fecha para activar esta opción"}</small></div></div><label className="switch"><input type="checkbox" checked={Boolean(task.calendarRequested)} disabled={!task.due} onChange={(event) => updateTask(task.id, { calendarRequested: event.target.checked })} /><i /></label></div>
              {task.calendarRequested && task.due && task.time && <label className="duration-field">Duración del evento<select value={task.durationMinutes || 30} onChange={(event) => updateTask(task.id, { durationMinutes: Number(event.target.value) })}><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="90">1 hora y media</option><option value="120">2 horas</option></select></label>}
              <datalist id="saved-task-projects">{projects.map((project) => <option key={project} value={project} />)}</datalist>
              <div className="editor-actions"><button className="delete-task" onClick={() => void deleteTask(task.id)}>Eliminar tarea</button><button className="confirm-btn" onClick={() => saveEditedTask(task)}>Guardar cambios</button></div>
            </section>
          </div>
        );
      })()}

      {showRamble && (
        <div className="ramble-screen">
          <header><button onClick={() => { streamRef.current?.getTracks().forEach((track) => track.stop()); setShowRamble(false); }} aria-label="Cerrar">×</button><div><span className="live-dot" /> Descarga mental</div><button className="text-action" onClick={() => updateThoughts("")}>Limpiar</button></header>
          <section className="ramble-intro">
            <div className={`voice-orb ${listening ? "listening" : ""}`}><span>≋</span></div>
            <h1>{listening ? "Te escucho…" : transcriptionStatus !== "idle" ? "Procesando tu voz…" : preview.length ? "Esto es lo que entendí" : "Suéltalo todo"}</h1>
            <p>{selectedProject ? `Las tareas de esta sesión se añadirán a ${selectedProject}.` : "Habla como piensas. Las tareas aparecerán organizadas y podrás revisarlas antes de guardarlas."}</p>
            <button className={`listen-btn ${listening ? "stop" : ""}`} onClick={listening ? stopListening : startListening} disabled={transcriptionStatus !== "idle"}>{listening ? "Parar y transcribir" : transcriptionStatus === "loading" ? `Preparando${modelProgress ? ` · ${modelProgress}%` : "…"}` : transcriptionStatus === "transcribing" ? "Transcribiendo…" : "Empezar a hablar"}</button>
            {listening && <div className="recording-indicator"><i /> Grabando audio</div>}
            {micMessage && <div className="mic-message" role="alert"><span>!</span><p>{micMessage}</p></div>}
          </section>
          <div className="transcript-wrap">
            <label htmlFor="thoughts">Transcripción de la sesión</label>
            <textarea id="thoughts" value={thoughts} onChange={(event) => updateThoughts(event.target.value)} placeholder="Mañana llamar al dentista a las nueve con prioridad alta. También comprar leche…" />
            <p className="transcript-note">Este cuadro conserva lo que se oyó. Las tarjetas muestran las tareas y órdenes ya interpretadas.</p>
          </div>
          <section className="preview-list" aria-live="polite">
            {preview.map((task, index) => (
              <article key={task.id} className={editingPreviewId === task.id ? "editing" : ""}>
                <div className="preview-summary">
                  <span className="preview-number">{index + 1}</span>
                  <div className="preview-main"><input aria-label={`Nombre de la tarea ${index + 1}`} value={task.title} onChange={(event) => updatePreviewTask(task.id, { title: event.target.value })} />
                    <p>{task.due ? relativeDate(task.due) : "Sin fecha"}{task.time ? ` · ${task.time}` : ""} · {task.project}{task.priority < 4 ? ` · P${task.priority}` : ""}</p>
                  </div>
                  <div className="preview-actions">
                    <button className="edit-preview" aria-label={`Editar detalles de ${task.title}`} aria-expanded={editingPreviewId === task.id} onClick={() => setEditingPreviewId((current) => current === task.id ? null : task.id)}><span>✎</span> Editar</button>
                    <button aria-label="Eliminar tarea" onClick={() => { setPreview((current) => current.filter((item) => item.id !== task.id)); setEditingPreviewId((current) => current === task.id ? null : current); }}>×</button>
                  </div>
                </div>
                {editingPreviewId === task.id && (
                  <div className="preview-editor">
                    <label>Fecha<input type="date" value={task.due || ""} onChange={(event) => updatePreviewTask(task.id, { due: event.target.value || undefined })} /></label>
                    <label>Hora<input type="time" value={task.time || ""} onChange={(event) => updatePreviewTask(task.id, { time: event.target.value || undefined })} /></label>
                    <label>Prioridad<select value={task.priority} onChange={(event) => updatePreviewTask(task.id, { priority: Number(event.target.value) as Priority })}><option value="4">Normal</option><option value="1">Alta · P1</option><option value="2">Media · P2</option><option value="3">Baja · P3</option></select></label>
                    <label className="project-field">Proyecto<input list="brisa-projects" value={task.project} onChange={(event) => updatePreviewTask(task.id, { project: event.target.value || "Bandeja de entrada" })} /></label>
                    <label className="project-field">Etiquetas<input value={task.labels.join(", ")} placeholder="casa, compras" onChange={(event) => updatePreviewTask(task.id, { labels: event.target.value.split(",").map((label) => label.trim().replace(/^@/, "")).filter(Boolean) })} /></label>
                    <label className="preview-calendar project-field"><span>Google Calendar</span><select value={task.calendarRequested ? "yes" : "no"} disabled={!task.due} onChange={(event) => updatePreviewTask(task.id, { calendarRequested: event.target.value === "yes" })}><option value="no">No añadir</option><option value="yes">Abrir al guardar</option></select></label>
                    <button className="done-editing" onClick={() => setEditingPreviewId(null)}>Listo</button>
                  </div>
                )}
              </article>
            ))}
            <datalist id="brisa-projects">{projects.map((project) => <option key={project} value={project} />)}</datalist>
          </section>
          <footer><button className="confirm-btn" onClick={confirmRamble} disabled={!preview.length}>Añadir {preview.length || ""} {preview.length === 1 ? "tarea" : "tareas"}</button><p>El audio se envía a Groq para transcribirlo; Brisa no lo guarda</p></footer>
        </div>
      )}

      {notice && <div className="toast">✓ {notice}</div>}
    </main>
  );
}
