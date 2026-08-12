import assert from "node:assert/strict";
import test from "node:test";
import { moveTaskCard, reorderSectionsList } from "../app/page";

const base = { priority: 4 as const, labels: [] as string[], completed: false, createdAt: "2026-08-12T00:00:00.000Z" };

test("reordena secciones antes y después sin perder ninguna", () => {
  assert.deepEqual(reorderSectionsList(["Ideas", "En curso", "Hecho"], "Ideas", "En curso", true), ["En curso", "Ideas", "Hecho"]);
  assert.deepEqual(reorderSectionsList(["Ideas", "En curso", "Hecho"], "Hecho", "Ideas"), ["Hecho", "Ideas", "En curso"]);
});

test("mueve una tarjeta y toda su familia a otra sección", () => {
  const tasks = [
    { ...base, id: "a", title: "Principal", project: "Editorial", section: "Ideas" },
    { ...base, id: "a1", title: "Subtarea", project: "Editorial", section: "Ideas", parentId: "a" },
    { ...base, id: "b", title: "Destino", project: "Editorial", section: "En curso" },
  ];
  const moved = moveTaskCard(tasks, "a", "Editorial", "En curso", "b", true);
  assert.deepEqual(moved.map((task) => task.id), ["b", "a", "a1"]);
  assert.equal(moved.find((task) => task.id === "a")?.section, "En curso");
  assert.equal(moved.find((task) => task.id === "a1")?.section, "En curso");
});

test("permite devolver una tarjeta a Sin sección", () => {
  const tasks = [
    { ...base, id: "a", title: "Principal", project: "Editorial", section: "Ideas" },
    { ...base, id: "b", title: "Sin sección", project: "Editorial" },
  ];
  const moved = moveTaskCard(tasks, "a", "Editorial", undefined, "b", false);
  assert.deepEqual(moved.map((task) => task.id), ["a", "b"]);
  assert.equal(moved[0].section, undefined);
});
