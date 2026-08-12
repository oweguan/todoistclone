"use client";

import { ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

type View = "inbox" | "today" | "upcoming" | "completed" | "browse";
type SmartFilter = "priority-1" | "no-date";
type Priority = 1 | 2 | 3 | 4;
type ProjectDetails = { description?: string; favorite?: boolean; archived?: boolean; color?: string; layout?: "list" | "board" };
type SectionDetails = { description?: string; archived?: boolean };
type SectionDialog = { mode: "create" | "edit" | "move"; project: string; section?: string; name: string; description: string; targetProject: string };
type DragState = { kind: "task" | "section" | "subtask"; id: string; overProject?: string; overSection?: string; overTask?: string; overDate?: string; after?: boolean; active: boolean; x: number; y: number };
type ViewGroup = "none" | "project" | "section";
type ViewSort = "manual" | "date" | "priority";
type SavedFilter = { id: string; name: string; query: string; favorite?: boolean };
type TaskComment = { id: string; text: string; createdAt: string };
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
  section?: string;
  parentId?: string;
  reminder?: string;
  comments?: TaskComment[];
};

const STORAGE_KEY = "brisa.tasks.v1";
const PROJECTS_KEY = "brisa.projects.v1";
const SECTIONS_KEY = "brisa.sections.v1";
const PROJECT_DETAILS_KEY = "brisa.project-details.v1";
const SECTION_DETAILS_KEY = "brisa.section-details.v1";
const FILTERS_KEY = "brisa.filters.v1";
const VIEW_OPTIONS_KEY = "brisa.view-options.v1";
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

function localISO(date: Date) {
  const value = new Date(date);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 10);
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

export function reorderSectionsList(sections: string[], source: string, target: string, after = false) {
  const next = sections.filter((section) => section !== source);
  const targetIndex = next.indexOf(target);
  if (!sections.includes(source) || targetIndex < 0) return sections;
  next.splice(targetIndex + (after ? 1 : 0), 0, source);
  return next;
}

export function moveTaskCard(all: Task[], draggedId: string, targetProject: string, targetSection: string | undefined, targetId?: string, after = false) {
  const dragged = all.find((task) => task.id === draggedId);
  if (!dragged) return all;
  const familyIds = new Set<string>([dragged.id]);
  let found = true;
  while (found) {
    found = false;
    all.forEach((task) => { if (task.parentId && familyIds.has(task.parentId) && !familyIds.has(task.id)) { familyIds.add(task.id); found = true; } });
  }
  const moving = all.filter((task) => familyIds.has(task.id)).map((task) => ({ ...task, project: targetProject, section: targetSection }));
  const remaining = all.filter((task) => !familyIds.has(task.id));
  if (targetId) {
    let targetIndex = remaining.findIndex((task) => task.id === targetId);
    if (targetIndex < 0) return [...remaining, ...moving];
    if (after) {
      const targetFamily = new Set([targetId]);
      let expanded = true;
      while (expanded) { expanded = false; remaining.forEach((task) => { if (task.parentId && targetFamily.has(task.parentId) && !targetFamily.has(task.id)) { targetFamily.add(task.id); expanded = true; } }); }
      const indexes = remaining.map((task, index) => targetFamily.has(task.id) ? index : -1).filter((index) => index >= 0);
      targetIndex = Math.max(...indexes) + 1;
    }
    return [...remaining.slice(0, targetIndex), ...moving, ...remaining.slice(targetIndex)];
  }
  const sectionIndexes = remaining.map((task, index) => task.project === targetProject && (task.section || "") === (targetSection || "") ? index : -1).filter((index) => index >= 0);
  const insertion = sectionIndexes.length ? Math.max(...sectionIndexes) + 1 : remaining.length;
  return [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)];
}

function matchesSavedFilter(task: Task, rawQuery: string) {
  const query = rawQuery.toLocaleLowerCase("es").trim();
  const parts = query.split("&").map((part) => part.trim()).filter(Boolean);
  return parts.every((part) => {
    if (part === "p1" || part === "p2" || part === "p3" || part === "p4") return task.priority === Number(part.slice(1));
    if (part === "hoy" || part === "today") return task.due === todayISO();
    if (part === "mañana" || part === "tomorrow") return task.due === addDaysISO(1);
    if (part === "sin fecha" || part === "no date") return !task.due;
    if (part === "vencida" || part === "overdue") return Boolean(task.due && task.due < todayISO());
    if (part.startsWith("@")) return task.labels.some((label) => label.toLocaleLowerCase("es") === part.slice(1));
    if (part.startsWith("#")) return task.project.toLocaleLowerCase("es") === part.slice(1);
    if (part.startsWith("buscar:")) return [task.title, task.description || ""].join(" ").toLocaleLowerCase("es").includes(part.slice(7).trim());
    return [task.title, task.description || "", task.project, ...task.labels].join(" ").toLocaleLowerCase("es").includes(part);
  });
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
  const [composerSection, setComposerSection] = useState<string | undefined>(undefined);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showRamble, setShowRamble] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [expandedCalendar, setExpandedCalendar] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleBusyTaskId, setGoogleBusyTaskId] = useState<string | null>(null);
  const [googleMessage, setGoogleMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<SmartFilter | null>(null);
  const [selectedSavedFilter, setSelectedSavedFilter] = useState<string | null>(null);
  const [newProject, setNewProject] = useState("");
  const [projectSections, setProjectSections] = useState<Record<string, string[]>>({});
  const [projectDetails, setProjectDetails] = useState<Record<string, ProjectDetails>>({});
  const [sectionDetails, setSectionDetails] = useState<Record<string, SectionDetails>>({});
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([
    { id: "filter-p1", name: "Prioridad 1", query: "p1", favorite: true },
    { id: "filter-no-date", name: "Sin fecha", query: "sin fecha" },
  ]);
  const [browsePane, setBrowsePane] = useState<"home" | "search" | "filters" | "projects" | "reports">("home");
  const [newFilterName, setNewFilterName] = useState("");
  const [newFilterQuery, setNewFilterQuery] = useState("");
  const [newSectionName, setNewSectionName] = useState("");
  const [sectionDialog, setSectionDialog] = useState<SectionDialog | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [viewGroup, setViewGroup] = useState<ViewGroup>("none");
  const [viewSort, setViewSort] = useState<ViewSort>("manual");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [bulkProject, setBulkProject] = useState("Bandeja de entrada");
  const [collapsedSections, setCollapsedSections] = useState<string[]>([]);
  const [sectionMenu, setSectionMenu] = useState<string | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [commentText, setCommentText] = useState("");
  const [composerDue, setComposerDue] = useState<string | undefined>(undefined);
  const [selectedUpcomingDate, setSelectedUpcomingDate] = useState(todayISO());
  const [showCompletedInProject, setShowCompletedInProject] = useState(false);
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
  const dragOriginRef = useRef<{ x: number; y: number; lastY: number; startedAt: number; scrolling: boolean } | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragTimerRef = useRef<number | null>(null);
  const transcriberRef = useRef<Promise<any> | null>(null);
  const googleClientIdRef = useRef("");
  const googleTokenClientRef = useRef<GoogleTokenClient | null>(null);
  const googleTokenRef = useRef<{ token: string; expiresAt: number } | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);
    setTheme(localStorage.getItem("brisa.theme") === "light" ? "light" : "dark");
    try {
      const options = JSON.parse(localStorage.getItem(VIEW_OPTIONS_KEY) || "{}");
      if (["none", "project", "section"].includes(options.group)) setViewGroup(options.group);
      if (["manual", "date", "priority"].includes(options.sort)) setViewSort(options.sort);
    } catch { /* keep default view options */ }
    const captureInstallPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    const saved = localStorage.getItem(STORAGE_KEY);
    let savedProjects: string[] = [];
    try {
      const parsedProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]");
      if (Array.isArray(parsedProjects)) savedProjects = parsedProjects;
    } catch { /* keep starter projects */ }
    setProjects(Array.from(new Set([...PROJECTS, ...savedProjects])));
    try {
      const savedSections = JSON.parse(localStorage.getItem(SECTIONS_KEY) || "{}");
      if (savedSections && typeof savedSections === "object" && !Array.isArray(savedSections)) setProjectSections(savedSections);
    } catch { /* keep projects without sections */ }
    try {
      const details = JSON.parse(localStorage.getItem(PROJECT_DETAILS_KEY) || "{}");
      if (details && typeof details === "object" && !Array.isArray(details)) setProjectDetails(details);
      const sectionInfo = JSON.parse(localStorage.getItem(SECTION_DETAILS_KEY) || "{}");
      if (sectionInfo && typeof sectionInfo === "object" && !Array.isArray(sectionInfo)) setSectionDetails(sectionInfo);
      const filters = JSON.parse(localStorage.getItem(FILTERS_KEY) || "[]");
      if (Array.isArray(filters) && filters.length) setSavedFilters(filters);
    } catch { /* keep starter organization */ }
    if (saved) {
      try {
        const savedTasks: Task[] = JSON.parse(saved);
        setTasks(savedTasks);
        const taskProjects = savedTasks.map((task) => task.project).filter(Boolean);
        setProjects(Array.from(new Set([...PROJECTS, ...(Array.isArray(savedProjects) ? savedProjects : []), ...taskProjects])));
      } catch { /* keep starter tasks */ }
    }
    setHydrated(true);
    if ("serviceWorker" in navigator) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!refreshing) { refreshing = true; window.location.reload(); } });
      navigator.serviceWorker.register("/sw.js?v=20", { updateViaCache: "none" }).then(async (registration) => { registration.waiting?.postMessage("SKIP_WAITING"); await registration.update(); registration.waiting?.postMessage("SKIP_WAITING"); }).catch(() => undefined);
    }
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

  useEffect(() => {
    if (hydrated) localStorage.setItem(SECTIONS_KEY, JSON.stringify(projectSections));
  }, [projectSections, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem("brisa.theme", theme);
  }, [theme, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(PROJECT_DETAILS_KEY, JSON.stringify(projectDetails));
    localStorage.setItem(SECTION_DETAILS_KEY, JSON.stringify(sectionDetails));
    localStorage.setItem(FILTERS_KEY, JSON.stringify(savedFilters));
  }, [projectDetails, sectionDetails, savedFilters, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(VIEW_OPTIONS_KEY, JSON.stringify({ group: viewGroup, sort: viewSort }));
  }, [viewGroup, viewSort, hydrated]);

  useEffect(() => {
    if (!hydrated || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const timers = tasks.flatMap((task) => {
      if (task.completed || !task.reminder) return [];
      const delay = new Date(task.reminder).getTime() - Date.now();
      const firedKey = `brisa.reminder-fired.${task.id}.${task.reminder}`;
      if (delay <= 0 || delay > 2_147_000_000 || localStorage.getItem(firedKey)) return [];
      return [window.setTimeout(() => {
        new Notification(task.title, { body: `${task.project}${task.due ? ` · ${relativeDate(task.due)}` : ""}`, icon: "/brisa-192.png" });
        localStorage.setItem(firedKey, "1");
      }, delay)];
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [tasks, hydrated]);

  const visibleTasks = useMemo(() => {
    const active = tasks.filter((task) => !task.completed || Boolean(selectedProject && showCompletedInProject));
    let result: Task[];
    const hasOrganizationFilter = Boolean(searchQuery.trim() || selectedProject || selectedLabel || selectedFilter || selectedSavedFilter);
    if (view === "completed") result = tasks.filter((task) => task.completed).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
    else if (view === "browse") result = searchQuery.trim() ? active : [];
    else if (hasOrganizationFilter) result = active;
    else if (view === "today") result = active.filter((task) => task.due === todayISO());
    else if (view === "upcoming") result = active.filter((task) => task.due && task.due >= todayISO()).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
    else result = active.filter((task) => task.project === "Bandeja de entrada");
    if (selectedProject) result = result.filter((task) => task.project === selectedProject);
    if (selectedLabel) result = result.filter((task) => task.labels.includes(selectedLabel));
    if (selectedFilter === "priority-1") result = result.filter((task) => task.priority === 1);
    if (selectedFilter === "no-date") result = result.filter((task) => !task.due);
    if (selectedSavedFilter) {
      const filter = savedFilters.find((item) => item.id === selectedSavedFilter);
      if (filter) result = result.filter((task) => matchesSavedFilter(task, filter.query));
    }
    const query = searchQuery.trim().toLocaleLowerCase("es");
    if (query) result = result.filter((task) => [task.title, task.description || "", task.project, ...task.labels].join(" ").toLocaleLowerCase("es").includes(query));
    result = result.filter((task) => !task.parentId);
    return result;
  }, [tasks, view, searchQuery, selectedProject, selectedLabel, selectedFilter, selectedSavedFilter, savedFilters, showCompletedInProject]);

  const availableLabels = useMemo(() => Array.from(new Set(tasks.flatMap((task) => task.labels))).sort((a, b) => a.localeCompare(b, "es")), [tasks]);
  const calendarTasks = useMemo(() => tasks.filter((task) => !task.completed && task.due).sort((a, b) => `${a.due}${a.time || ""}`.localeCompare(`${b.due}${b.time || ""}`)), [tasks]);
  const displayTasks = useMemo(() => {
    const isSectionView = Boolean(selectedProject || (view === "inbox" && !selectedLabel && !selectedFilter && !selectedSavedFilter && !searchQuery));
    if (isSectionView) return visibleTasks;
    if (viewSort === "date") return [...visibleTasks].sort((a, b) => `${a.due || "9999"}${a.time || ""}`.localeCompare(`${b.due || "9999"}${b.time || ""}`));
    if (viewSort === "priority") return [...visibleTasks].sort((a, b) => a.priority - b.priority);
    return visibleTasks;
  }, [visibleTasks, viewSort, selectedProject, view, selectedLabel, selectedFilter, selectedSavedFilter, searchQuery]);
  const plainInbox = view === "inbox" && !selectedProject && !selectedLabel && !selectedFilter && !selectedSavedFilter && !searchQuery;
  const sectionProject = selectedProject || (plainInbox ? "Bandeja de entrada" : null);

  const counts = {
    inbox: tasks.filter((task) => !task.completed && task.project === "Bandeja de entrada").length,
    today: tasks.filter((task) => !task.completed && task.due === todayISO()).length,
    upcoming: tasks.filter((task) => !task.completed && task.due && task.due >= todayISO()).length,
  };

  function addQuickTask() {
    if (!quickTitle.trim()) return;
    const parsed = parseThoughts(quickTitle)[0];
    const task = parsed || { id: uid(), title: quickTitle.trim(), project: "Bandeja de entrada", priority: 4 as Priority, labels: [], completed: false, createdAt: new Date().toISOString() };
    const preparedTask = { ...task, ...(composerDue ? { due: composerDue } : {}) };
    setTasks((current) => [...current, sectionProject ? { ...preparedTask, project: sectionProject, section: composerSection } : preparedTask]);
    setQuickTitle("");
    setComposerSection(undefined);
    setComposerDue(undefined);
    setShowComposer(false);
    flash("Tarea añadida");
  }

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  }

  async function requestReminderPermission() {
    if (!("Notification" in window)) { flash("Este navegador no admite notificaciones"); return; }
    const permission = await Notification.requestPermission();
    flash(permission === "granted" ? "Recordatorios activados" : "Permiso de notificaciones no concedido");
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
    setTasks((current) => current.map((item) => item.id === id || (completing && item.parentId === id) ? { ...item, completed: completing, completedAt: completing ? new Date().toISOString() : undefined, ...(completing && item.calendarEventId ? { calendarEventId: undefined, calendarSyncedAt: undefined, calendarSyncState: undefined } : {}), ...(!completing && item.calendarRequested ? { calendarSyncState: "pending" as const } : {}) } : item));
    if (completing && task.calendarEventId) flash("Tarea completada y evento retirado");
  }

  function updateTask(id: string, changes: Partial<Task>) {
    const syncFields: Array<keyof Task> = ["title", "description", "due", "time", "durationMinutes", "recurring"];
    const childChanges: Partial<Task> = {};
    if ("project" in changes) childChanges.project = changes.project;
    if ("section" in changes) childChanges.section = changes.section;
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...changes, ...(task.calendarEventId && syncFields.some((field) => field in changes) ? { calendarSyncState: "pending" as const } : {}) } : task.parentId === id ? { ...task, ...childChanges } : task));
  }

  async function deleteTask(id: string) {
    const task = tasks.find((item) => item.id === id);
    if (task?.calendarEventId && !(await removeGoogleEvent(task))) { flash("No eliminé la tarea: falta borrar su evento"); return; }
    setTasks((current) => current.filter((item) => item.id !== id && item.parentId !== id));
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
    setSelectedFilter(null);
    setSelectedSavedFilter(null);
  }

  function changeView(nextView: View) {
    clearOrganizationFilters();
    setView(nextView);
    setShowMenu(false);
  }

  function openProject(project: string) {
    setSearchQuery("");
    setSelectedLabel(null);
    setSelectedFilter(null);
    setSelectedSavedFilter(null);
    setSelectedProject(project);
    setView("inbox");
    setShowMenu(false);
  }

  function addProject() {
    const name = newProject.trim();
    if (!name || projects.some((project) => project.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) return;
    setProjects((current) => [...current, name]);
    setProjectDetails((current) => ({ ...current, [name]: { color: "#df514f" } }));
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
    setProjectDetails((current) => { const next = { ...current, [name]: current[oldName] || {} }; delete next[oldName]; return next; });
    setSectionDetails((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key.startsWith(`${oldName}::`) ? `${name}${key.slice(oldName.length)}` : key, value])));
    setProjectSections((current) => {
      if (!current[oldName]) return current;
      const next = { ...current, [name]: current[oldName] };
      delete next[oldName];
      return next;
    });
    if (selectedProject === oldName) setSelectedProject(name);
    setRenamingProject(null);
    flash("Proyecto renombrado");
  }

  function deleteProject(project: string) {
    if (project === "Bandeja de entrada") return;
    setProjects((current) => current.filter((item) => item !== project));
    setTasks((current) => current.filter((task) => task.project !== project));
    setProjectSections((current) => { const next = { ...current }; delete next[project]; return next; });
    setProjectDetails((current) => { const next = { ...current }; delete next[project]; return next; });
    setSectionDetails((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${project}::`))));
    if (selectedProject === project) setSelectedProject(null);
    flash("Proyecto y tareas eliminados");
  }

  function addSection(nameOverride?: string) {
    if (!sectionProject) return;
    const name = nameOverride?.trim() || newSectionName.trim();
    if (!name || (projectSections[sectionProject] || []).length >= 20 || (projectSections[sectionProject] || []).some((section) => section.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) return;
    setProjectSections((current) => ({ ...current, [sectionProject]: [...(current[sectionProject] || []), name] }));
    setNewSectionName("");
    flash("Sección añadida");
  }

  function openSectionDialog(mode: SectionDialog["mode"], section?: string, projectOverride?: string) {
    const project = projectOverride || sectionProject || projects.find((item) => item !== "Bandeja de entrada" && !projectDetails[item]?.archived) || "Bandeja de entrada";
    const details = section ? sectionDetails[sectionKey(project, section)] : undefined;
    setSectionMenu(null);
    const targetProject = mode === "move" ? projects.find((item) => item !== project && !projectDetails[item]?.archived) || "" : project;
    setSectionDialog({ mode, project, section, name: section || "", description: details?.description || "", targetProject });
  }

  function saveSectionDialog() {
    if (!sectionDialog) return;
    const sourceProject = sectionDialog.project;
    if (sectionDialog.mode === "create") {
      const name = sectionDialog.name.trim();
      if (!name || (projectSections[sourceProject] || []).length >= 20 || (projectSections[sourceProject] || []).some((section) => section.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))) return;
      setProjectSections((current) => ({ ...current, [sourceProject]: [...(current[sourceProject] || []), name] }));
      if (sectionDialog.description.trim()) setSectionDetails((current) => ({ ...current, [sectionKey(sourceProject, name)]: { description: sectionDialog.description.trim() } }));
      setSectionDialog(null); flash("Sección añadida"); return;
    }
    const oldSection = sectionDialog.section;
    if (!oldSection) return;
    if (sectionDialog.mode === "move") {
      const target = sectionDialog.targetProject;
      if (!target || target === sourceProject) { setSectionDialog(null); return; }
      const targetSections = projectSections[target] || [];
      if (targetSections.length >= 20) { flash("El proyecto de destino ya tiene 20 secciones"); return; }
      let movedName = oldSection; let suffix = 2;
      while (targetSections.some((item) => item.toLocaleLowerCase("es") === movedName.toLocaleLowerCase("es"))) movedName = `${oldSection} (${suffix++})`;
      setProjectSections((current) => ({ ...current, [sourceProject]: (current[sourceProject] || []).filter((item) => item !== oldSection), [target]: [...(current[target] || []), movedName] }));
      setTasks((current) => current.map((task) => task.project === sourceProject && task.section === oldSection ? { ...task, project: target, section: movedName } : task));
      const oldKey = sectionKey(sourceProject, oldSection); const newKey = sectionKey(target, movedName);
      setSectionDetails((current) => { const next = { ...current, [newKey]: current[oldKey] || {} }; delete next[oldKey]; return next; });
      setSectionDialog(null); flash(`Sección movida a ${target}`); return;
    }
    const name = sectionDialog.name.trim();
    if (!name || ((projectSections[sourceProject] || []).some((item) => item !== oldSection && item.toLocaleLowerCase("es") === name.toLocaleLowerCase("es")))) return;
    setProjectSections((current) => ({ ...current, [sourceProject]: (current[sourceProject] || []).map((item) => item === oldSection ? name : item) }));
    setTasks((current) => current.map((task) => task.project === sourceProject && task.section === oldSection ? { ...task, section: name } : task));
    const oldKey = sectionKey(sourceProject, oldSection); const newKey = sectionKey(sourceProject, name);
    setSectionDetails((current) => { const next = { ...current, [newKey]: { ...current[oldKey], description: sectionDialog.description.trim() || undefined } }; if (oldKey !== newKey) delete next[oldKey]; return next; });
    setSectionDialog(null); flash("Sección actualizada");
  }

  function moveSection(section: string, direction: -1 | 1) {
    if (!sectionProject) return;
    setProjectSections((current) => {
      const sections = [...(current[sectionProject] || [])];
      const index = sections.indexOf(section);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= sections.length) return current;
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...current, [sectionProject]: sections };
    });
    setSectionMenu(null);
  }

  function deleteSection(section: string) {
    if (!sectionProject) return;
    if (!window.confirm(`Eliminar “${section}” y todas sus tareas? Esta acción no se puede deshacer.`)) return;
    setProjectSections((current) => ({ ...current, [sectionProject]: (current[sectionProject] || []).filter((item) => item !== section) }));
    setTasks((current) => current.filter((task) => !(task.project === sectionProject && task.section === section)));
    setSectionMenu(null);
    flash("Sección y tareas eliminadas");
  }

  function sectionKey(project: string, section: string) { return `${project}::${section}`; }

  function editSection(section: string) {
    openSectionDialog("edit", section);
  }

  function describeSection(section: string) {
    openSectionDialog("edit", section);
  }

  function duplicateSection(section: string) {
    if (!sectionProject) return;
    const existing = projectSections[sectionProject] || [];
    if (existing.length >= 20) { flash("Este proyecto ya tiene 20 secciones"); return; }
    let copyName = `Copia de ${section}`; let suffix = 2;
    while (existing.some((item) => item.toLocaleLowerCase("es") === copyName.toLocaleLowerCase("es"))) copyName = `Copia de ${section} (${suffix++})`;
    setProjectSections((current) => ({ ...current, [sectionProject]: [...(current[sectionProject] || []), copyName] }));
    setSectionDetails((current) => ({ ...current, [sectionKey(sectionProject, copyName)]: { ...current[sectionKey(sectionProject, section)], archived: false } }));
    const originals = tasks.filter((task) => task.project === sectionProject && task.section === section && !task.completed);
    const idMap = new Map(originals.map((task) => [task.id, uid()]));
    setTasks((current) => [...current, ...originals.map((task) => ({ ...task, id: idMap.get(task.id)!, section: copyName, parentId: task.parentId ? idMap.get(task.parentId) : undefined, comments: [], createdAt: new Date().toISOString() }))]);
    setSectionMenu(null); flash("Sección duplicada");
  }

  function archiveSection(section: string) {
    if (!sectionProject) return;
    const key = sectionKey(sectionProject, section);
    const archived = Boolean(sectionDetails[key]?.archived);
    setSectionDetails((current) => ({ ...current, [key]: { ...current[key], archived: !archived } }));
    if (!archived) setTasks((current) => current.map((task) => task.project === sectionProject && task.section === section ? { ...task, completed: true, completedAt: new Date().toISOString() } : task));
    setSectionMenu(null); flash(archived ? "Sección restaurada" : "Sección archivada");
  }

  function duplicateProject(project: string) {
    const copyName = `Copia de ${project}`;
    setProjects((current) => [...current, copyName]);
    setProjectDetails((current) => ({ ...current, [copyName]: { ...current[project], favorite: false, archived: false } }));
    setProjectSections((current) => ({ ...current, [copyName]: [...(current[project] || [])] }));
    setSectionDetails((current) => ({ ...current, ...Object.fromEntries(Object.entries(current).filter(([key]) => key.startsWith(`${project}::`)).map(([key, value]) => [`${copyName}${key.slice(project.length)}`, { ...value, archived: false }])) }));
    const originals = tasks.filter((task) => task.project === project && !task.completed);
    const idMap = new Map(originals.map((task) => [task.id, uid()]));
    setTasks((current) => [...current, ...originals.map((task) => ({ ...task, id: idMap.get(task.id)!, project: copyName, parentId: task.parentId ? idMap.get(task.parentId) : undefined, comments: [], reminder: undefined, createdAt: new Date().toISOString() }))]);
    openProject(copyName); flash("Proyecto duplicado");
  }

  async function copyBrisaLink(kind: "project" | "section" | "task", value: string) {
    const normalizedValue = kind === "section" && value.startsWith("null/") ? `Bandeja de entrada/${value.slice(5)}` : value;
    const url = `${window.location.origin}${window.location.pathname}#${kind}=${encodeURIComponent(normalizedValue)}`;
    try { await navigator.clipboard.writeText(url); flash("Enlace copiado"); } catch { flash("No se pudo copiar el enlace"); }
  }

  function duplicateTask(task: Task) {
    const children = tasks.filter((item) => item.parentId === task.id && !item.completed);
    const newId = uid();
    setTasks((current) => [...current, { ...task, id: newId, title: `Copia de ${task.title}`, completed: false, completedAt: undefined, comments: [], createdAt: new Date().toISOString() }, ...children.map((child) => ({ ...child, id: uid(), parentId: newId, completed: false, completedAt: undefined, comments: [], createdAt: new Date().toISOString() }))]);
    flash("Tarea duplicada");
  }

  function addComment(task: Task) {
    const text = commentText.trim(); if (!text) return;
    updateTask(task.id, { comments: [...(task.comments || []), { id: uid(), text, createdAt: new Date().toISOString() }] });
    setCommentText("");
  }

  function addSavedFilter() {
    const name = newFilterName.trim(); const query = newFilterQuery.trim();
    if (!name || !query) return;
    setSavedFilters((current) => [...current, { id: uid(), name, query }]);
    setNewFilterName(""); setNewFilterQuery(""); flash("Filtro guardado");
  }

  function moveTask(id: string, direction: -1 | 1) {
    setTasks((current) => {
      const task = current.find((item) => item.id === id);
      if (!task) return current;
      const siblings = current.filter((item) => item.project === task.project && (item.section || "") === (task.section || "") && (item.parentId || "") === (task.parentId || "") && item.completed === task.completed);
      const siblingIndex = siblings.findIndex((item) => item.id === id);
      const other = siblings[siblingIndex + direction];
      if (!other) return current;
      const from = current.findIndex((item) => item.id === id);
      const to = current.findIndex((item) => item.id === other.id);
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  function setCurrentDrag(next: DragState | null) {
    dragStateRef.current = next;
    setDragState(next);
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, kind: DragState["kind"], id: string) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOriginRef.current = { x: event.clientX, y: event.clientY, lastY: event.clientY, startedAt: performance.now(), scrolling: false };
    setCurrentDrag({ kind, id, active: false, x: event.clientX, y: event.clientY });
    if (dragTimerRef.current) window.clearTimeout(dragTimerRef.current);
    const directHandle = Boolean((event.target as HTMLElement).closest(".task-drag-handle, .section-drag-handle, .subtask-drag-handle"));
    dragTimerRef.current = window.setTimeout(() => {
      const current = dragStateRef.current;
      if (current?.id === id && current.kind === kind && !dragOriginRef.current?.scrolling) setCurrentDrag({ ...current, active: true });
    }, directHandle ? 40 : 260);
  }

  function updateDrag(event: ReactPointerEvent<HTMLElement>) {
    const current = dragStateRef.current;
    const origin = dragOriginRef.current;
    if (!current || !origin) return;
    const distance = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (!current.active && (origin.scrolling || distance > 12)) {
      if (!origin.scrolling && dragTimerRef.current) window.clearTimeout(dragTimerRef.current);
      origin.scrolling = true;
      if (Math.abs(event.clientY - origin.y) >= Math.abs(event.clientX - origin.x)) window.scrollBy({ top: origin.lastY - event.clientY });
      origin.lastY = event.clientY;
      return;
    }
    if (!current.active) return;
    const active = current.active || distance > 5;
    if (!active) return;
    event.preventDefault();
    if (event.clientY < 72) window.scrollBy({ top: -16 });
    if (event.clientY > window.innerHeight - 118) window.scrollBy({ top: 16 });
    if (sectionProject && projectLayout === "board") {
      const board = document.querySelector<HTMLElement>(".project-layout-board");
      if (board && event.clientX < 55) board.scrollBy({ left: -18 });
      if (board && event.clientX > window.innerWidth - 55) board.scrollBy({ left: 18 });
    }
    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const projectElement = element?.closest<HTMLElement>("[data-project-drop]");
    const sectionElement = element?.closest<HTMLElement>("[data-section-drop]");
    const dateElement = element?.closest<HTMLElement>("[data-date-drop]");
    const overProject = projectElement?.dataset.projectDrop;
    const overSection = sectionElement ? sectionElement.dataset.sectionDrop || "" : undefined;
    const overDate = dateElement?.dataset.dateDrop;
    if (current.kind === "task" || current.kind === "subtask") {
      const taskElement = element?.closest<HTMLElement>(current.kind === "subtask" ? "[data-subtask-drop]" : "[data-task-drop]");
      const overTask = current.kind === "subtask" ? taskElement?.dataset.subtaskDrop : taskElement?.dataset.taskDrop;
      const after = taskElement ? event.clientY > taskElement.getBoundingClientRect().top + taskElement.getBoundingClientRect().height / 2 : false;
      setCurrentDrag({ ...current, active: true, x: event.clientX, y: event.clientY, overProject, overSection, overDate, overTask: overTask === current.id ? undefined : overTask, after });
    } else {
      const rect = sectionElement?.getBoundingClientRect();
      const after = rect ? projectLayout === "board" ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2 : false;
      setCurrentDrag({ ...current, active: true, x: event.clientX, y: event.clientY, overProject, overSection: overSection === current.id ? undefined : overSection, after });
    }
  }

  function finishDrag(event: ReactPointerEvent<HTMLElement>) {
    if (dragTimerRef.current) { window.clearTimeout(dragTimerRef.current); dragTimerRef.current = null; }
    if (event.type === "pointercancel") {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* pointer already released */ }
      dragOriginRef.current = null;
      setCurrentDrag(null);
      return;
    }
    const current = dragStateRef.current;
    const origin = dragOriginRef.current;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* pointer already released */ }
    dragOriginRef.current = null;
    setCurrentDrag(null);
    if (current?.kind === "task" && !current.active && origin?.scrolling) {
      const deltaX = event.clientX - origin.x;
      const deltaY = event.clientY - origin.y;
      if (Math.abs(deltaX) > 88 && Math.abs(deltaX) > Math.abs(deltaY) * 1.35) {
        if (deltaX > 0) void toggleTask(current.id);
        else { setSubtaskTitle(""); setEditingTaskId(current.id); }
        return;
      }
    }
    if (!current?.active) return;
    if (current.kind === "subtask" && current.overTask) {
      setTasks((all) => {
        const dragged = all.find((task) => task.id === current.id);
        const target = all.find((task) => task.id === current.overTask);
        if (!dragged?.parentId || target?.parentId !== dragged.parentId) return all;
        const remaining = all.filter((task) => task.id !== dragged.id);
        let targetIndex = remaining.findIndex((task) => task.id === target.id);
        if (targetIndex < 0) return all;
        if (current.after) targetIndex += 1;
        return [...remaining.slice(0, targetIndex), dragged, ...remaining.slice(targetIndex)];
      });
      flash("Subtareas reordenadas");
      return;
    }
    if (current.kind === "section" && current.overSection && sectionProject) {
      setProjectSections((all) => ({ ...all, [sectionProject]: reorderSectionsList(all[sectionProject] || [], current.id, current.overSection!, current.after) }));
      flash("Secciones reordenadas");
      return;
    }
    if (current.kind === "task") {
      if (!current.overProject && !current.overTask && current.overSection === undefined && !current.overDate) return;
      setTasks((all) => {
        const dragged = all.find((task) => task.id === current.id);
        if (!dragged) return all;
        const hasDestination = Boolean(current.overProject || current.overTask || current.overSection !== undefined);
        const targetProject = current.overProject || dragged.project;
        const targetSection = current.overSection !== undefined ? current.overSection || undefined : dragged.section;
        const moved = hasDestination ? moveTaskCard(all, current.id, targetProject, targetSection, current.overTask, current.after) : all;
        if (!current.overDate) return moved;
        const familyIds = new Set([current.id]);
        let expanded = true;
        while (expanded) { expanded = false; moved.forEach((task) => { if (task.parentId && familyIds.has(task.parentId) && !familyIds.has(task.id)) { familyIds.add(task.id); expanded = true; } }); }
        return moved.map((task) => familyIds.has(task.id) ? { ...task, due: current.overDate } : task);
      });
      flash(current.overDate ? "Tarea movida y reprogramada" : "Tarea movida");
    }
  }

  function addSubtask(parent: Task) {
    const title = subtaskTitle.trim();
    if (!title) return;
    setTasks((current) => [...current, { id: uid(), title, project: parent.project, section: parent.section, parentId: parent.id, due: parent.due, priority: 4, labels: [], completed: false, createdAt: new Date().toISOString() }]);
    setSubtaskTitle("");
    flash("Subtarea añadida");
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => !current);
    setSelectedTaskIds([]);
    setShowMenu(false);
  }

  function selectedFamilies(all: Task[]) {
    const ids = new Set(selectedTaskIds);
    let expanded = true;
    while (expanded) { expanded = false; all.forEach((task) => { if (task.parentId && ids.has(task.parentId) && !ids.has(task.id)) { ids.add(task.id); expanded = true; } }); }
    return ids;
  }

  function completeSelectedTasks() {
    const completedAt = new Date().toISOString();
    setTasks((all) => { const ids = selectedFamilies(all); return all.map((task) => ids.has(task.id) ? { ...task, completed: true, completedAt } : task); });
    setSelectedTaskIds([]); setSelectionMode(false); flash("Tareas completadas");
  }

  function moveSelectedTasks() {
    setTasks((all) => { const ids = selectedFamilies(all); return all.map((task) => ids.has(task.id) ? { ...task, project: bulkProject, section: undefined } : task); });
    setSelectedTaskIds([]); setSelectionMode(false); flash(`Tareas movidas a ${bulkProject}`);
  }

  function deleteSelectedTasks() {
    if (!window.confirm(`Eliminar ${selectedTaskIds.length} tareas seleccionadas?`)) return;
    setTasks((all) => { const ids = selectedFamilies(all); return all.filter((task) => !ids.has(task.id)); });
    setSelectedTaskIds([]); setSelectionMode(false); flash("Tareas eliminadas");
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
    const backup = { app: "Brisa", version: 4, exportedAt: new Date().toISOString(), projects, projectDetails, projectSections, sectionDetails, savedFilters, tasks };
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
      if (backup.projectSections && typeof backup.projectSections === "object" && !Array.isArray(backup.projectSections)) setProjectSections(backup.projectSections);
      if (backup.projectDetails && typeof backup.projectDetails === "object") setProjectDetails(backup.projectDetails);
      if (backup.sectionDetails && typeof backup.sectionDetails === "object") setSectionDetails(backup.sectionDetails);
      if (Array.isArray(backup.savedFilters)) setSavedFilters(backup.savedFilters);
      flash("Copia restaurada");
    } catch { flash("No reconozco esta copia"); }
    event.target.value = "";
    setShowMenu(false);
  }

  function renderTaskCard(task: Task, nested = false) {
    const children = tasks.filter((item) => item.parentId === task.id && !item.completed);
    return (
      <div data-task-drop={!nested ? task.id : undefined} className={`task-family ${nested ? "nested" : ""} ${selectedTaskIds.includes(task.id) ? "selected" : ""} ${dragState?.id === task.id ? "is-dragging" : ""} ${dragState?.overTask === task.id ? dragState.after ? "drop-after" : "drop-before" : ""}`} key={task.id}>
        <article className={`task-card p${task.priority}`} onPointerDown={(event) => { if (!nested && !selectionMode && !(event.target as HTMLElement).closest("button, input, select, textarea, a")) beginDrag(event, "task", task.id); }} onPointerMove={!nested ? updateDrag : undefined} onPointerUp={!nested ? finishDrag : undefined} onPointerCancel={!nested ? finishDrag : undefined}>
          {!nested && (selectionMode ? <button className={`task-select-toggle ${selectedTaskIds.includes(task.id) ? "active" : ""}`} onClick={() => setSelectedTaskIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} aria-label={`Seleccionar ${task.title}`}>{selectedTaskIds.includes(task.id) ? "✓" : ""}</button> : <button className="task-drag-handle" onPointerDown={(event) => beginDrag(event, "task", task.id)} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} aria-label={`Mantén pulsado y arrastra ${task.title}`}>⠿</button>)}
          <button className="check" onClick={() => void toggleTask(task.id)} disabled={googleBusyTaskId === task.id} aria-label={task.completed ? `Reabrir ${task.title}` : `Completar ${task.title}`}><span>{task.completed ? "✓" : ""}</span></button>
          <div className="task-body">
            <h2 className={task.completed ? "done" : ""}>{task.title}</h2>
            {task.description && <p className="description">{task.description}</p>}
            <div className="task-meta">
              {task.due && <span className={task.due === todayISO() ? "due-today" : ""}>◷ {relativeDate(task.due)}{task.time ? ` · ${task.time}` : ""}</span>}
              {task.recurring && <span>↻ {task.recurring}</span>}
              {task.due && <button className={`calendar-chip ${task.calendarEventId ? "synced" : task.calendarOpenedAt ? "opened" : ""}`} onClick={() => handleCalendarAction(task)} disabled={googleBusyTaskId === task.id}>▦ {googleBusyTaskId === task.id ? "Sincronizando…" : task.calendarEventId ? (task.calendarSyncState === "pending" ? "Actualizar Calendar" : "Sincronizada") : task.calendarOpenedAt ? "Abrir de nuevo" : task.calendarRequested ? "Añadir a Calendar" : "Calendar"}</button>}
              <span className="project-dot"><i />{nested ? "Subtarea" : task.project}</span>
              {task.labels.map((label) => <span key={label}>@{label}</span>)}
            </div>
          </div>
          <div className="task-side-actions">
            <button className="task-edit-btn" onClick={() => { setSubtaskTitle(""); setEditingTaskId(task.id); }} aria-label={`Editar ${task.title}`}><span>✎</span> Editar</button>
          </div>
        </article>
        {children.length > 0 && <div className="subtask-list">{children.map((child) => renderTaskCard(child, true))}</div>}
      </div>
    );
  }

  function renderSmartTaskList() {
    if (view === "upcoming") {
      return Array.from(new Set(displayTasks.map((task) => task.due).filter(Boolean))).map((date) => <section className={`upcoming-day-group ${dragState?.overDate === date ? "drop-date-target" : ""}`} data-date-drop={date} key={date}><header><strong>{new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`))}</strong>{date === todayISO() && <span>Hoy</span>}{date === addDaysISO(1) && <span>Mañana</span>}<button onClick={() => { setComposerDue(date); setShowComposer(true); }}>＋</button></header>{displayTasks.filter((task) => task.due === date).map((task) => renderTaskCard(task))}</section>);
    }
    if (viewGroup === "none") return displayTasks.map((task) => renderTaskCard(task));
    const groups = new Map<string, { project: string; section?: string; tasks: Task[] }>();
    displayTasks.forEach((task) => {
      const key = viewGroup === "project" ? task.project : `${task.project}::${task.section || "sin-seccion"}`;
      const current = groups.get(key) || { project: task.project, section: viewGroup === "section" ? task.section : undefined, tasks: [] };
      current.tasks.push(task); groups.set(key, current);
    });
    return Array.from(groups.entries()).map(([key, group]) => <section className={`smart-task-group ${dragState?.overProject === group.project && (viewGroup !== "section" || (dragState.overSection || "") === (group.section || "")) ? "drop-section-target" : ""}`} data-project-drop={group.project} data-section-drop={viewGroup === "section" ? group.section || "" : undefined} key={key}><header><div><strong>{viewGroup === "project" ? group.project : group.section || "Sin sección"}</strong>{viewGroup === "section" && <small>{group.project}</small>}</div><span>{group.tasks.length}</span></header>{group.tasks.map((task) => renderTaskCard(task))}</section>);
  }

  const viewNames: Record<View, string> = { inbox: "Bandeja de entrada", today: "Hoy", upcoming: "Próximo", completed: "Completadas", browse: "Explorar" };
  const currentTitle = selectedProject || (selectedLabel ? `@${selectedLabel}` : selectedSavedFilter ? savedFilters.find((item) => item.id === selectedSavedFilter)?.name || "Filtro" : selectedFilter === "priority-1" ? "Prioridad 1" : selectedFilter === "no-date" ? "Sin fecha" : searchQuery ? "Resultados" : viewNames[view]);
  const currentEyebrow = selectedProject ? "Proyecto" : selectedLabel ? "Etiqueta" : selectedFilter || selectedSavedFilter ? "Filtro" : searchQuery ? "Búsqueda" : view === "today" ? new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(new Date()) : "Tu espacio";
  const projectLayout = sectionProject ? projectDetails[sectionProject]?.layout || "list" : "list";
  const groupLabels: Record<ViewGroup, string> = { none: "Sin agrupar", project: "Por proyecto", section: "Por sección" };
  const sortLabels: Record<ViewSort, string> = { manual: "Manual", date: "Fecha", priority: "Prioridad" };
  const cycleGroup = () => setViewGroup((current) => current === "none" ? "project" : current === "project" ? "section" : "none");
  const cycleSort = () => setViewSort((current) => current === "manual" ? "date" : current === "date" ? "priority" : "manual");
  const draggedTask = dragState?.kind === "task" ? tasks.find((task) => task.id === dragState.id) : undefined;

  return (
    <main className={`app-shell theme-${theme} ${dragState?.active ? "dragging-active" : ""}`}>
      {view !== "browse" && <header className="topbar">
        <button className="brand current-view-brand" aria-label={selectedProject ? "Volver a Explorar" : "Ir a Hoy"} onClick={() => selectedProject ? changeView("browse") : changeView("today")}>{selectedProject && <span className="back-symbol">‹</span>}<span>{currentTitle}</span></button>
        <div className="top-actions">
          <button className="icon-btn" onClick={openRamble} aria-label="Abrir Descarga mental"><span className="wave-mini">≋</span></button>
          {sectionProject && <button className="icon-btn layout-toggle" onClick={() => setProjectDetails((current) => ({ ...current, [sectionProject]: { ...current[sectionProject], layout: projectLayout === "list" ? "board" : "list" } }))} aria-label={projectLayout === "list" ? "Cambiar a tablero" : "Cambiar a lista"}>{projectLayout === "list" ? "▦" : "☷"}</button>}
          <button className="icon-btn" onClick={() => setShowMenu((value) => !value)} aria-label="Abrir menú">•••</button>
        </div>
        {showMenu && (
          <div className="overflow-menu">
            {selectedProject ? <>
              <button onClick={() => { openSectionDialog("create"); setShowMenu(false); }}><span>▣</span> Añadir sección</button>
              <button onClick={() => { setProjectDetails((current) => ({ ...current, [selectedProject]: { ...current[selectedProject], layout: projectLayout === "list" ? "board" : "list" } })); setShowMenu(false); }}><span>{projectLayout === "list" ? "▦" : "☷"}</span> Vista {projectLayout === "list" ? "tablero" : "lista"}</button>
              <button onClick={() => void copyBrisaLink("project", selectedProject)}><span>↗</span> Copiar enlace al proyecto</button>
              <button onClick={() => { const description = window.prompt("Descripción del proyecto", projectDetails[selectedProject]?.description || ""); if (description !== null) setProjectDetails((current) => ({ ...current, [selectedProject]: { ...current[selectedProject], description: description.trim() || undefined } })); setShowMenu(false); }}><span>☵</span> Descripción</button>
              <button onClick={() => { setProjectDetails((current) => ({ ...current, [selectedProject]: { ...current[selectedProject], favorite: !current[selectedProject]?.favorite } })); setShowMenu(false); }}><span>♥</span> {projectDetails[selectedProject]?.favorite ? "Quitar de Favoritos" : "Añadir a Favoritos"}</button>
              <button onClick={() => { setShowCompletedInProject((value) => !value); setShowMenu(false); }}><span>✓</span> {showCompletedInProject ? "Ocultar completadas" : "Mostrar completadas"}</button>
              <button onClick={toggleSelectionMode}><span>☑</span> Seleccionar tareas</button>
              <button onClick={() => { duplicateProject(selectedProject); setShowMenu(false); }}><span>⧉</span> Duplicar proyecto</button>
              <button onClick={() => { setProjectDetails((current) => ({ ...current, [selectedProject]: { ...current[selectedProject], archived: true } })); changeView("browse"); }}><span>⌄</span> Archivar proyecto</button>
              <button className="danger-menu-item" onClick={() => { const project = selectedProject; deleteProject(project); changeView("browse"); }}>× Eliminar proyecto</button>
            </> : <>
              {plainInbox && <><button onClick={() => { openSectionDialog("create", undefined, "Bandeja de entrada"); setShowMenu(false); }}><span>▣</span> Añadir sección</button><button onClick={() => { setProjectDetails((current) => ({ ...current, ["Bandeja de entrada"]: { ...current["Bandeja de entrada"], layout: projectLayout === "list" ? "board" : "list" } })); setShowMenu(false); }}><span>{projectLayout === "list" ? "▦" : "☷"}</span> Vista {projectLayout === "list" ? "tablero" : "lista"}</button></>}
              <button onClick={toggleSelectionMode}><span>☑</span> Seleccionar tareas</button>
              {!plainInbox && <><button onClick={() => { cycleGroup(); setShowMenu(false); }}><span>≡</span> Agrupar: {groupLabels[viewGroup]}</button><button onClick={() => { cycleSort(); setShowMenu(false); }}><span>↕</span> Orden: {sortLabels[viewSort]}</button><button onClick={() => { openSectionDialog("create"); setShowMenu(false); }}><span>▣</span> Crear sección en…</button></>}
              {!isStandalone && <button onClick={installAndroidApp}><span>⇩</span> Instalar en Android</button>}
              <button onClick={() => { setShowSettings(true); setShowMenu(false); }}><span>⚙</span> Configuración</button>
              <div className="menu-divider" />
              <button onClick={exportBackup}><span>⇩</span> Crear copia</button>
              <button onClick={() => importRef.current?.click()}><span>⇧</span> Restaurar copia</button>
            </>}
            <input ref={importRef} type="file" accept="application/json" onChange={importBackup} hidden />
          </div>
        )}
      </header>}
      {selectedProject && projectDetails[selectedProject]?.description && <button className="project-description-line" onClick={() => { const description = window.prompt("Descripción del proyecto", projectDetails[selectedProject]?.description || ""); if (description !== null) setProjectDetails((current) => ({ ...current, [selectedProject]: { ...current[selectedProject], description: description.trim() || undefined } })); }}>{projectDetails[selectedProject]?.description}</button>}

      <section className="content">
        {view === "browse" ? (
          <div className="browse-home">
            <div className="browse-heading">
              <div>{browsePane !== "home" && <button className="browse-back" onClick={() => { setBrowsePane("home"); setSearchQuery(""); }}>‹</button>}<span className="profile-mark">B</span><div><p className="eyebrow">Tu espacio</p><h1>{browsePane === "search" ? "Buscar" : browsePane === "filters" ? "Filtros y Etiquetas" : browsePane === "projects" ? "Gestionar proyectos" : browsePane === "reports" ? "Reportes" : "Brisa"}</h1></div></div>
              <button onClick={() => setShowSettings(true)} aria-label="Abrir configuración">⚙</button>
            </div>
            {browsePane === "home" && <>
              <section className="browse-section browse-primary-actions"><div className="browse-rows"><button onClick={() => setBrowsePane("search")}><span className="browse-symbol">⌕</span><span><strong>Buscar</strong><small>Tareas, proyectos, secciones, comentarios y etiquetas</small></span><b>›</b></button><button onClick={() => setBrowsePane("filters")}><span className="browse-symbol">▦</span><span><strong>Filtros y Etiquetas</strong><small>Crea vistas con consultas combinadas</small></span><b>›</b></button><button onClick={() => setBrowsePane("reports")}><span className="browse-symbol">⌁</span><span><strong>Reportes</strong><small>{tasks.filter((task) => task.completed).length} tareas completadas</small></span><b>›</b></button></div></section>
              {projects.some((project) => projectDetails[project]?.favorite && !projectDetails[project]?.archived) && <section className="browse-section"><div className="browse-section-title"><h2>Favoritos</h2></div><div className="browse-project-list">{projects.filter((project) => projectDetails[project]?.favorite && !projectDetails[project]?.archived).map((project) => <div className="project-row" key={project}><button className="project-filter" onClick={() => openProject(project)}><i /><span>{project}</span><b>{tasks.filter((task) => !task.completed && task.project === project).length}</b></button></div>)}</div></section>}
              <section className="browse-section"><div className="browse-section-title"><h2>Mis Proyectos</h2><button className="title-add" onClick={() => setBrowsePane("projects")}>＋</button></div><div className="browse-project-list">{projects.filter((project) => project !== "Bandeja de entrada" && !projectDetails[project]?.archived).map((project) => <div className="project-row" key={project}><button className="project-filter" onClick={() => openProject(project)}><i /><span>{project}</span><b>{tasks.filter((task) => !task.completed && task.project === project).length}</b></button></div>)}<button className="manage-projects" onClick={() => setBrowsePane("projects")}>✎ <span>Gestionar proyectos</span></button></div></section>
              <section className="browse-section"><div className="browse-rows"><button onClick={() => setShowCalendar(true)}><span className="browse-symbol calendar-symbol">▦</span><span><strong>Google Calendar</strong><small>{googleConnected ? "Conectado" : "Conectar y sincronizar"}</small></span><b>›</b></button><button onClick={() => setShowSettings(true)}><span className="browse-symbol">?</span><span><strong>Ayuda y configuración</strong><small>Personalización, datos y conexiones</small></span><b>›</b></button></div></section>
            </>}
            {browsePane === "search" && <><label className="browse-search"><span>⌕</span><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Buscar en Brisa" /><button onClick={() => setSearchQuery("")}>{searchQuery ? "×" : ""}</button></label>{searchQuery.trim() ? <div className="search-groups"><section><h2>Tareas</h2>{tasks.filter((task) => [task.title, task.description || ""].join(" ").toLocaleLowerCase("es").includes(searchQuery.toLocaleLowerCase("es"))).map((task) => <button key={task.id} onClick={() => setEditingTaskId(task.id)}><span>○</span><div><strong>{task.title}</strong><small>{task.project}{task.section ? ` / ${task.section}` : ""}</small></div></button>)}</section><section><h2>Proyectos y secciones</h2>{projects.filter((project) => project.toLocaleLowerCase("es").includes(searchQuery.toLocaleLowerCase("es"))).map((project) => <button key={project} onClick={() => openProject(project)}><span>#</span><div><strong>{project}</strong><small>Proyecto</small></div></button>)}{Object.entries(projectSections).flatMap(([project, sections]) => sections.filter((section) => section.toLocaleLowerCase("es").includes(searchQuery.toLocaleLowerCase("es"))).map((section) => <button key={`${project}-${section}`} onClick={() => openProject(project)}><span>/</span><div><strong>{section}</strong><small>{project}</small></div></button>))}</section><section><h2>Etiquetas y comentarios</h2>{availableLabels.filter((label) => label.toLocaleLowerCase("es").includes(searchQuery.toLocaleLowerCase("es"))).map((label) => <button key={label} onClick={() => { clearOrganizationFilters(); setSelectedLabel(label); setView("inbox"); }}><span>@</span><div><strong>{label}</strong><small>Etiqueta</small></div></button>)}{tasks.flatMap((task) => (task.comments || []).filter((comment) => comment.text.toLocaleLowerCase("es").includes(searchQuery.toLocaleLowerCase("es"))).map((comment) => <button key={comment.id} onClick={() => setEditingTaskId(task.id)}><span>☵</span><div><strong>{comment.text}</strong><small>{task.title}</small></div></button>))}</section></div> : <p className="pane-hint">Busca por nombre, descripción, proyecto, sección, etiqueta o comentario.</p>}</>}
            {browsePane === "filters" && <><section className="browse-section"><div className="browse-section-title"><h2>Filtros</h2><span>{savedFilters.length}</span></div><div className="browse-rows">{savedFilters.map((filter) => <button key={filter.id} onClick={() => { clearOrganizationFilters(); setSelectedSavedFilter(filter.id); setView("inbox"); }}><span className="browse-symbol">⌁</span><span><strong>{filter.name}</strong><small>{filter.query}</small></span><b>{tasks.filter((task) => !task.completed && matchesSavedFilter(task, filter.query)).length}</b></button>)}</div><div className="filter-creator"><input value={newFilterName} onChange={(event) => setNewFilterName(event.target.value)} placeholder="Nombre del filtro" /><input value={newFilterQuery} onChange={(event) => setNewFilterQuery(event.target.value)} placeholder="Consulta: hoy & @email" /><button onClick={addSavedFilter} disabled={!newFilterName.trim() || !newFilterQuery.trim()}>Añadir filtro</button></div></section><section className="browse-section"><div className="browse-section-title"><h2>Etiquetas</h2><span>{availableLabels.length}</span></div><div className="label-cloud">{availableLabels.length ? availableLabels.map((label) => <button key={label} onClick={() => { clearOrganizationFilters(); setSelectedLabel(label); setView("inbox"); }}>@{label}</button>) : <p>Añade etiquetas desde una tarea.</p>}</div></section></>}
            {browsePane === "projects" && <section className="browse-section"><div className="browse-project-list manage-list">{projects.filter((project) => project !== "Bandeja de entrada").map((project) => renamingProject === project ? <div className="rename-project" key={project}><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /><button onClick={saveProjectRename}>Guardar</button><button onClick={() => setRenamingProject(null)}>×</button></div> : <div className={`project-row ${projectDetails[project]?.archived ? "archived" : ""}`} key={project}><button className="favorite-toggle" onClick={() => setProjectDetails((current) => ({ ...current, [project]: { ...current[project], favorite: !current[project]?.favorite } }))}>{projectDetails[project]?.favorite ? "♥" : "♡"}</button><button className="project-filter" onClick={() => openProject(project)}><i /><span>{project}</span><b>{tasks.filter((task) => !task.completed && task.project === project).length}</b></button><button onClick={() => { setRenamingProject(project); setRenameValue(project); }}>✎</button><button onClick={() => setProjectDetails((current) => ({ ...current, [project]: { ...current[project], archived: !current[project]?.archived } }))}>{projectDetails[project]?.archived ? "↺" : "⌄"}</button><button onClick={() => deleteProject(project)}>×</button></div>)}</div><div className="new-project"><input value={newProject} onChange={(event) => setNewProject(event.target.value)} placeholder="Nombre del proyecto" /><button onClick={addProject} disabled={!newProject.trim()}>＋ Añadir</button></div></section>}
            {browsePane === "reports" && <section className="reports-pane"><article className="report-hero"><span>✓</span><div><strong>{tasks.filter((task) => task.completed).length}</strong><small>Tareas completadas</small></div></article><h2>Por proyecto</h2><div className="report-projects">{projects.map((project) => { const completed = tasks.filter((task) => task.completed && task.project === project).length; const total = tasks.filter((task) => task.project === project).length; return total ? <div key={project}><header><strong>{project}</strong><span>{completed}/{total}</span></header><i><b style={{ width: `${Math.round(completed / total * 100)}%` }} /></i></div> : null; })}</div><button className="completed-link" onClick={() => changeView("completed")}>Ver todas las tareas completadas</button></section>}
          </div>
        ) : (
        <>
        {view === "upcoming" && <section className={`upcoming-calendar ${expandedCalendar ? "expanded" : ""}`}>
          <button className="month-toggle" onClick={() => setExpandedCalendar((value) => !value)}>{new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date())}<span>{expandedCalendar ? "▴" : "▾"}</span></button>
          <div className="calendar-days">{Array.from({ length: expandedCalendar ? 28 : 7 }, (_, index) => {
            const date = new Date(); date.setDate(date.getDate() + index); const iso = localISO(date); const hasTasks = tasks.some((task) => !task.completed && task.due === iso);
            return <button key={iso} className={`${index === 0 ? "today" : ""} ${selectedUpcomingDate === iso ? "selected" : ""}`} onClick={() => setSelectedUpcomingDate(iso)}><small>{new Intl.DateTimeFormat("es-ES", { weekday: "narrow" }).format(date)}</small><span>{date.getDate()}</span>{hasTasks && <i />}</button>;
          })}</div>
        </section>}
        <div className="view-heading compact-view-heading">
          <div>
            <p className="eyebrow">{currentEyebrow}</p>
            <h1>{currentTitle}</h1>
          </div>
          <span className="task-total">{displayTasks.length}</span>
        </div>
        {(searchQuery || selectedLabel || selectedFilter || selectedSavedFilter) && <div className="active-filters"><span>{searchQuery && `“${searchQuery}”`}{selectedLabel && ` · @${selectedLabel}`}{selectedFilter === "priority-1" && " · Prioridad 1"}{selectedFilter === "no-date" && " · Sin fecha"}{selectedSavedFilter && ` · ${savedFilters.find((item) => item.id === selectedSavedFilter)?.name || "Filtro"}`}</span><button onClick={clearOrganizationFilters}>Quitar filtros</button></div>}
        {!sectionProject && <div className="smart-view-tools"><button onClick={() => openSectionDialog("create")}>＋ Crear sección</button><button onClick={cycleGroup}>≡ {groupLabels[viewGroup]}</button><button onClick={cycleSort}>↕ {sortLabels[viewSort]}</button></div>}

        <div className={`task-list ${sectionProject ? `project-task-list project-layout-${projectLayout}` : ""}`}>
          {sectionProject ? (() => {
            const configuredSections = (projectSections[sectionProject] || []).filter((section) => showCompletedInProject || !sectionDetails[`${sectionProject}::${section}`]?.archived);
            const sectionNames = ["", ...configuredSections];
            return <>
              <button className="add-section-launch" onClick={() => openSectionDialog("create")}>＋ Añadir sección</button>
              <p className="drag-hint">Mantén pulsado ⠿ y arrastra para ordenar o cambiar de sección.</p>
              {sectionNames.map((section) => {
                const sectionTasks = displayTasks.filter((task) => (task.section || "") === section);
                if (!section && !sectionTasks.length && configuredSections.length && projectLayout === "list" && dragState?.kind !== "task") return null;
                const sectionKey = `${sectionProject}::${section || "sin-seccion"}`;
                const collapsed = collapsedSections.includes(sectionKey);
                return <section data-project-drop={sectionProject} data-section-drop={section} className={`project-section ${sectionDetails[sectionKey]?.archived ? "archived" : ""} ${dragState?.kind === "section" && dragState.id === section ? "is-dragging" : ""} ${dragState?.overProject === sectionProject && dragState?.overSection === section ? dragState.kind === "task" ? "drop-section-target" : dragState.after ? "drop-after-section" : "drop-before-section" : ""}`} key={sectionKey}>
                  <header>{section ? <button className="section-drag-handle" onPointerDown={(event) => beginDrag(event, "section", section)} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} aria-label={`Mantén pulsado y arrastra la sección ${section}`}>⠿</button> : <span className="section-drag-spacer" />}<button className="section-toggle" onClick={() => setCollapsedSections((current) => current.includes(sectionKey) ? current.filter((item) => item !== sectionKey) : [...current, sectionKey])} aria-expanded={!collapsed}><span>{collapsed ? "›" : "⌄"}</span><strong>{section || "Sin sección"}</strong><small>{sectionTasks.length}</small></button><button className="section-more" onClick={() => setSectionMenu((current) => current === sectionKey ? null : sectionKey)} aria-label={`Opciones de ${section || "Sin sección"}`}>•••</button>{sectionMenu === sectionKey && <div className="section-menu"><button onClick={() => { setComposerSection(section || undefined); setShowComposer(true); setSectionMenu(null); }}>＋ Añadir tarea</button>{section && <><button onClick={() => void copyBrisaLink("section", `${selectedProject}/${section}`)}>↗ Copiar enlace</button><button onClick={() => editSection(section)}>✎ Editar sección</button><button onClick={() => describeSection(section)}>☵ Descripción</button><button onClick={() => openSectionDialog("move", section)}>→ Mover a otro proyecto</button><button onClick={() => moveSection(section, -1)}>↑ Mover arriba</button><button onClick={() => moveSection(section, 1)}>↓ Mover abajo</button><button onClick={() => duplicateSection(section)}>⧉ Duplicar sección</button><button onClick={() => archiveSection(section)}>{sectionDetails[sectionKey]?.archived ? "↺ Restaurar sección" : "⌄ Archivar sección"}</button><button className="danger" onClick={() => deleteSection(section)}>× Eliminar sección</button></>}</div>}</header>
                  {section && sectionDetails[sectionKey]?.description && <button className="section-description" onClick={() => describeSection(section)}>{sectionDetails[sectionKey]?.description}</button>}
                  {!collapsed && <div className="section-tasks">{sectionTasks.map((task) => renderTaskCard(task))}{!sectionTasks.length && <p className="section-empty">Todavía no hay tareas en esta sección.</p>}<button className="section-inline-add" onClick={() => { setComposerSection(section || undefined); setShowComposer(true); }}>＋ Añadir tarea</button></div>}
                </section>;
              })}
            </>;
          })() : renderSmartTaskList()}
          {!displayTasks.length && !(sectionProject && (projectSections[sectionProject] || []).length) && (
            <div className="empty-state">
              <div className="empty-orbit"><span>✓</span></div>
              <h2>{selectedProject ? `${selectedProject} está vacío` : view === "completed" ? "Aún no hay tareas completadas" : "Todo despejado"}</h2>
              <p>{selectedProject ? "Añade aquí la primera tarea de este proyecto." : view === "completed" ? "Tus pequeños avances aparecerán aquí." : "Disfruta del espacio o captura lo siguiente que tengas en mente."}</p>
              {sectionProject && !(projectSections[sectionProject] || []).length && <div className="empty-project-actions"><button className="empty-voice" onClick={openRamble}><span>≋</span> Hablar</button><button className="empty-add" onClick={() => { setComposerSection(undefined); setShowComposer(true); }}>＋ Escribir</button></div>}
            </div>
          )}
        </div>
        </>
        )}
      </section>

      {dragState?.active && draggedTask && <><div className="drag-card-ghost" style={{ transform: `translate3d(${dragState.x + 12}px, ${dragState.y + 12}px, 0)` }}><strong>{draggedTask.title}</strong><small>{dragState.overProject || draggedTask.project}{dragState.overSection ? ` / ${dragState.overSection}` : ""}</small></div><div className="drag-destination-dock" aria-label="Destinos para mover la tarea"><header><strong>Mover a…</strong><span>Arrastra y suelta</span></header><div className="drag-destination-scroll">{projects.filter((project) => !projectDetails[project]?.archived).map((project) => <div className={`drag-project-target ${dragState.overProject === project && dragState.overSection === undefined ? "active" : ""}`} data-project-drop={project} key={project}><strong>{project}</strong><div>{(projectSections[project] || []).map((section) => <span className={dragState.overProject === project && dragState.overSection === section ? "active" : ""} data-project-drop={project} data-section-drop={section} key={section}>{section}</span>)}</div></div>)}</div></div></>}

      <button className="ramble-fab" onClick={openRamble} aria-label="Descarga mental"><span className="pulse" /><span className="wave">≋</span></button>
      <button className="add-fab" onClick={() => { setComposerSection(undefined); setComposerDue(view === "today" ? todayISO() : view === "upcoming" ? selectedUpcomingDate : undefined); setShowComposer(true); }} aria-label="Añadir tarea">+</button>

      <nav className="bottom-nav" aria-label="Navegación principal">
        <button className={view === "inbox" && !selectedProject && !selectedLabel && !selectedFilter && !selectedSavedFilter && !searchQuery ? "active" : ""} onClick={() => changeView("inbox")}><span className="nav-icon">▱</span><span>Bandeja</span>{counts.inbox > 0 && <b>{counts.inbox}</b>}</button>
        <button className={view === "today" && !selectedProject && !selectedLabel && !selectedFilter && !selectedSavedFilter && !searchQuery ? "active" : ""} onClick={() => changeView("today")}><span className="calendar-icon">{new Date().getDate()}</span><span>Hoy</span>{counts.today > 0 && <b>{counts.today}</b>}</button>
        <button className={view === "upcoming" && !selectedProject && !selectedLabel && !selectedFilter && !selectedSavedFilter && !searchQuery ? "active" : ""} onClick={() => changeView("upcoming")}><span className="nav-icon">▦</span><span>Próximo</span></button>
        <button className={view === "browse" ? "active" : ""} onClick={() => changeView("browse")}><span className="browse-nav-icon"><i /><i /><i /></span><span>Explorar</span></button>
      </nav>

      {selectionMode && <div className="bulk-task-toolbar"><header><strong>{selectedTaskIds.length} seleccionadas</strong><button onClick={toggleSelectionMode}>×</button></header><div><select value={bulkProject} onChange={(event) => setBulkProject(event.target.value)}>{projects.filter((project) => !projectDetails[project]?.archived).map((project) => <option key={project}>{project}</option>)}</select><button onClick={moveSelectedTasks} disabled={!selectedTaskIds.length}>Mover</button><button onClick={completeSelectedTasks} disabled={!selectedTaskIds.length}>✓</button><button className="danger" onClick={deleteSelectedTasks} disabled={!selectedTaskIds.length}>×</button></div></div>}

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

      {showSettings && <div className="settings-screen">
        <header><button onClick={() => setShowSettings(false)} aria-label="Volver">‹</button><h2>Configuración</h2></header>
        <section><h3>Personalización</h3><button onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}><span>◐</span><div><strong>Tema</strong><small>{theme === "dark" ? "Oscuro" : "Claro"}</small></div><b>›</b></button><button onClick={() => flash("La barra usa Bandeja, Hoy, Próximo y Explorar, como en Todoist Android")}><span>▣</span><div><strong>Barra de navegación</strong><small>Bandeja, Hoy, Próximo y Explorar</small></div><b>›</b></button><button onClick={openRamble}><span>≋</span><div><strong>Descarga mental</strong><small>Captura rápida por voz</small></div><b>›</b></button></section>
        <section><h3>Productividad</h3><button onClick={() => { setShowCalendar(true); setShowSettings(false); }}><span>▦</span><div><strong>Calendario</strong><small>{googleConnected ? "Google Calendar conectado" : "Configurar Google Calendar"}</small></div><b>›</b></button><button onClick={() => void requestReminderPermission()}><span>◷</span><div><strong>Recordatorios</strong><small>{typeof Notification !== "undefined" && Notification.permission === "granted" ? "Notificaciones activadas" : "Activar notificaciones del navegador"}</small></div><b>›</b></button></section>
        <section><h3>Datos</h3><button onClick={exportBackup}><span>⇩</span><div><strong>Crear copia de seguridad</strong><small>Guarda proyectos, secciones y tareas</small></div><b>›</b></button><button onClick={() => importRef.current?.click()}><span>⇧</span><div><strong>Restaurar copia</strong><small>Recupera una copia de Brisa</small></div><b>›</b></button>{!isStandalone && <button onClick={installAndroidApp}><span>＋</span><div><strong>Instalar Brisa</strong><small>Añadir a la pantalla de inicio</small></div><b>›</b></button>}</section>
      </div>}

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

      {sectionDialog && (
        <div className="sheet-backdrop section-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSectionDialog(null)}>
          <section className="section-dialog sheet" aria-label={sectionDialog.mode === "create" ? "Crear sección" : sectionDialog.mode === "move" ? "Mover sección" : "Editar sección"}>
            <div className="sheet-handle" />
            <div className="section-dialog-heading"><div><p>Proyecto · {sectionDialog.project}</p><h2>{sectionDialog.mode === "create" ? "Nueva sección" : sectionDialog.mode === "move" ? `Mover ${sectionDialog.section}` : "Editar sección"}</h2></div><button onClick={() => setSectionDialog(null)} aria-label="Cerrar">×</button></div>
            {sectionDialog.mode === "move" ? <label>Proyecto de destino<select autoFocus value={sectionDialog.targetProject} onChange={(event) => setSectionDialog((current) => current ? { ...current, targetProject: event.target.value } : current)}>{projects.filter((project) => project !== sectionDialog.project && !projectDetails[project]?.archived).map((project) => <option key={project}>{project}</option>)}</select></label> : <>{sectionDialog.mode === "create" && <label>Proyecto<select value={sectionDialog.project} onChange={(event) => setSectionDialog((current) => current ? { ...current, project: event.target.value } : current)}>{projects.filter((project) => !projectDetails[project]?.archived).map((project) => <option key={project}>{project}</option>)}</select></label>}<label>Nombre<input autoFocus value={sectionDialog.name} maxLength={120} onChange={(event) => setSectionDialog((current) => current ? { ...current, name: event.target.value } : current)} onKeyDown={(event) => event.key === "Enter" && saveSectionDialog()} placeholder="Ej. En progreso" /></label><label>Descripción<textarea value={sectionDialog.description} onChange={(event) => setSectionDialog((current) => current ? { ...current, description: event.target.value } : current)} placeholder="Contexto breve para esta fase" /></label></>}
            <div className="section-dialog-actions"><button onClick={() => setSectionDialog(null)}>Cancelar</button><button className="confirm-btn" onClick={saveSectionDialog} disabled={sectionDialog.mode === "move" ? !sectionDialog.targetProject || sectionDialog.targetProject === sectionDialog.project : !sectionDialog.name.trim()}>{sectionDialog.mode === "move" ? "Mover sección" : sectionDialog.mode === "create" ? "Añadir sección" : "Guardar"}</button></div>
          </section>
        </div>
      )}

      {showComposer && (
        <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowComposer(false)}>
          <section className="composer sheet">
            <div className="sheet-handle" />
            <label htmlFor="quick-task">¿Qué necesitas hacer?</label>
            <textarea id="quick-task" autoFocus value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="Ej. Llamar a Marta mañana a las 10 p1" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); addQuickTask(); } }} />
            <div className="composer-tools"><span>{selectedProject ? `Se añadirá a ${selectedProject}${composerSection ? ` · ${composerSection}` : ""}` : "Entiendo fechas, horas, proyectos y prioridades"}</span><button onClick={addQuickTask} disabled={!quickTitle.trim()}>Añadir</button></div>
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
              <div className="editor-heading"><div><p># {task.project}{task.section ? ` / ${task.section}` : ""}</p><h2>Detalles de la tarea</h2></div><button onClick={() => setEditingTaskId(null)} aria-label="Cerrar editor">×</button></div>
              <label className="editor-title">Nombre<input autoFocus value={task.title} onChange={(event) => updateTask(task.id, { title: event.target.value })} /></label>
              <label className="editor-description">Descripción<textarea value={task.description || ""} onChange={(event) => updateTask(task.id, { description: event.target.value || undefined })} placeholder="Añade notas, enlaces o contexto" /></label>
              <div className="task-action-chips"><button onClick={() => document.querySelector<HTMLInputElement>('.labels-field input')?.focus()}>◇ Etiquetas</button><button onClick={() => document.querySelector<HTMLInputElement>('.reminder-field input')?.focus()}>◷ Recordatorio</button><button onClick={() => document.querySelector<HTMLTextAreaElement>('.editor-description textarea')?.focus()}>☵ Descripción</button><button onClick={() => document.querySelector<HTMLInputElement>('.editor-project-field input')?.focus()}>→ Mover a…</button><button onClick={() => void copyBrisaLink("task", task.id)}>↗ Enlace</button></div>
              <div className="editor-grid">
                <label>Fecha<input type="date" value={task.due || ""} onChange={(event) => updateTask(task.id, { due: event.target.value || undefined })} /></label>
                <label>Hora<input type="time" value={task.time || ""} onChange={(event) => updateTask(task.id, { time: event.target.value || undefined })} /></label>
                <label>Prioridad<select value={task.priority} onChange={(event) => updateTask(task.id, { priority: Number(event.target.value) as Priority })}><option value="4">Normal</option><option value="1">Alta · P1</option><option value="2">Media · P2</option><option value="3">Baja · P3</option></select></label>
                <label className="editor-project-field">Proyecto<input list="saved-task-projects" value={task.project} onChange={(event) => updateTask(task.id, { project: event.target.value || "Bandeja de entrada", section: undefined })} /></label>
                <label className="section-field">Sección<select value={task.section || ""} onChange={(event) => updateTask(task.id, { section: event.target.value || undefined })}><option value="">Sin sección</option>{(projectSections[task.project] || []).map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                <label className="labels-field">Etiquetas<input value={task.labels.join(", ")} placeholder="casa, llamadas, urgente" onChange={(event) => updateTask(task.id, { labels: event.target.value.split(",").map((label) => label.trim().replace(/^@/, "")).filter(Boolean) })} /></label>
                <label className="reminder-field">Recordatorio<input type="datetime-local" value={task.reminder || ""} onChange={(event) => updateTask(task.id, { reminder: event.target.value || undefined })} /></label>
              </div>
              {!task.parentId && <div className="subtask-editor">
                <div className="subtask-editor-heading"><strong>Subtareas</strong><span>{tasks.filter((item) => item.parentId === task.id).length}</span></div>
                <div className="editor-subtask-list">{tasks.filter((item) => item.parentId === task.id).map((child) => <div data-subtask-drop={child.id} className={`${dragState?.id === child.id ? "is-dragging" : ""} ${dragState?.overTask === child.id ? dragState.after ? "drop-after" : "drop-before" : ""}`} key={child.id}><button className="subtask-drag-handle" onPointerDown={(event) => beginDrag(event, "subtask", child.id)} onPointerMove={updateDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} aria-label={`Mantén pulsado y arrastra ${child.title}`}>⠿</button><button className={`mini-check ${child.completed ? "done" : ""}`} onClick={() => void toggleTask(child.id)} aria-label={child.completed ? `Reabrir ${child.title}` : `Completar ${child.title}`}>{child.completed ? "✓" : ""}</button><button className="subtask-name" onClick={() => { setSubtaskTitle(""); setEditingTaskId(child.id); }}>{child.title}</button><button className="remove-subtask" onClick={() => void deleteTask(child.id)} aria-label={`Eliminar ${child.title}`}>×</button></div>)}</div>
                <div className="add-subtask"><input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addSubtask(task)} placeholder="Añadir una subtarea" /><button onClick={() => addSubtask(task)} disabled={!subtaskTitle.trim()}>Añadir</button></div>
              </div>}
              <div className={`calendar-option ${task.calendarRequested ? "selected" : ""}`}><div><span>▦</span><div><strong>Google Calendar</strong><small>{task.due ? "Abrir el evento preparado al guardar" : "Añade una fecha para activar esta opción"}</small></div></div><label className="switch"><input type="checkbox" checked={Boolean(task.calendarRequested)} disabled={!task.due} onChange={(event) => updateTask(task.id, { calendarRequested: event.target.checked })} /><i /></label></div>
              {task.calendarRequested && task.due && task.time && <label className="duration-field">Duración del evento<select value={task.durationMinutes || 30} onChange={(event) => updateTask(task.id, { durationMinutes: Number(event.target.value) })}><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="90">1 hora y media</option><option value="120">2 horas</option></select></label>}
              <div className="task-comments"><div className="subtask-editor-heading"><strong>Comentarios</strong><span>{task.comments?.length || 0}</span></div>{(task.comments || []).map((comment) => <article key={comment.id}><p>{comment.text}</p><small>{new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(comment.createdAt))}</small></article>)}<div className="comment-composer"><input value={commentText} onChange={(event) => setCommentText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addComment(task)} placeholder="Añade un comentario" /><button onClick={() => addComment(task)} disabled={!commentText.trim()}>Enviar</button></div></div>
              <datalist id="saved-task-projects">{projects.map((project) => <option key={project} value={project} />)}</datalist>
              <div className="task-secondary-actions"><button onClick={() => duplicateTask(task)}>⧉ Duplicar</button><button onClick={() => void copyBrisaLink("task", task.id)}>↗ Copiar enlace</button></div><div className="editor-actions"><button className="delete-task" onClick={() => void deleteTask(task.id)}>Eliminar tarea</button><button className="confirm-btn" onClick={() => saveEditedTask(task)}>Guardar cambios</button></div>
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
