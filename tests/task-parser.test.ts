import assert from "node:assert/strict";
import test from "node:test";
import { parseThoughts, todayISO, addDaysISO, googleCalendarUrl } from "../app/page";

test("separa varias tareas y comprende fechas, horas y prioridades", () => {
  const tasks = parseThoughts("Mañana llamar a Ana a las cinco de la tarde prioridad alta y comprar pan esta tarde");
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].title, "Llamar a Ana");
  assert.equal(tasks[0].due, addDaysISO(1));
  assert.equal(tasks[0].time, "17:00");
  assert.equal(tasks[0].priority, 1);
  assert.equal(tasks[1].title, "Comprar pan");
  assert.equal(tasks[1].due, todayISO());
});

test("corrige la última tarea sin perder su título", () => {
  const tasks = parseThoughts("Llamar a Ana mañana. En realidad el viernes. Mejor prioridad alta");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Llamar a Ana");
  assert.equal(tasks[0].priority, 1);
  assert.ok(tasks[0].due);
});

test("elimina una tarea nombrada dentro de la sesión", () => {
  const tasks = parseThoughts("Comprar pan. Llamar a Ana. Borra la tarea de comprar");
  assert.deepEqual(tasks.map((task) => task.title), ["Llamar a Ana"]);
});

test("resuelve la transcripción real con corrección y una segunda grabación", () => {
  const firstRecording = "Mañana llamará Ana a las 5 de la tarde con prioridad alta. En realidad, mejor el viernes. También comprar pan esta tarde.";
  const firstTasks = parseThoughts(firstRecording);
  assert.equal(firstTasks.length, 2);
  assert.equal(firstTasks[0].title, "Llamar a Ana");
  assert.equal(firstTasks[0].time, "17:00");
  assert.equal(firstTasks[0].priority, 1);
  assert.equal(firstTasks[1].title, "Comprar pan");
  assert.equal(firstTasks[1].due, todayISO());

  const secondRecording = `${firstRecording}.. borrar la tarea de comprar pan. borrar la tarea de comprar pan`;
  const finalTasks = parseThoughts(secondRecording);
  assert.deepEqual(finalTasks.map((task) => task.title), ["Llamar a Ana"]);
});

test("tolera está tarde en una transcripción y conserva la hora", () => {
  const tasks = parseThoughts("Revisar el lanzamiento de la falo está tarde a las 18 horas.");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Revisar el lanzamiento de la falo");
  assert.equal(tasks[0].due, todayISO());
  assert.equal(tasks[0].time, "18:00");
});

test("corrige la transcripción observada de un verbo y un nombre pegado", () => {
  const tasks = parseThoughts("Revesar el lanzamiento delázaro, que está tarde a las 18 horas.");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Revisar el lanzamiento de Lázaro");
  assert.equal(tasks[0].due, todayISO());
  assert.equal(tasks[0].time, "18:00");
});

test("reconoce una petición para Google Calendar sin ensuciar el título", () => {
  const tasks = parseThoughts("Revisar el lanzamiento de Lázaro mañana a las 18 horas y añádelo al calendario");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Revisar el lanzamiento de Lázaro");
  assert.equal(tasks[0].calendarRequested, true);
  assert.match(googleCalendarUrl(tasks[0]), /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.match(googleCalendarUrl(tasks[0]), /text=Revisar\+el\+lanzamiento\+de\+L%C3%A1zaro/);
});
