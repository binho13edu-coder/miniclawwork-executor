'use strict';

function enumeratePlans(tasks, capacity) {
  if (!Array.isArray(tasks) || !Number.isFinite(capacity) || capacity < 0) {
    throw new TypeError('tasks e capacity inválidos');
  }
  const normalized = tasks.map((task, index) => {
    if (!task || typeof task.id !== 'string' || !Number.isFinite(task.hours) || task.hours < 0) {
      throw new TypeError('tarefa inválida no índice ' + index);
    }
    return {
      id: task.id,
      hours: task.hours,
      reward: Number.isFinite(task.reward) ? task.reward : 0,
      deadlineToday: task.deadlineToday === true,
      penalty: Number.isFinite(task.penalty) ? task.penalty : 0
    };
  });
  const results = [];
  for (let mask = 0; mask < 2 ** normalized.length; mask += 1) {
    const selected = normalized.filter((_, i) => (mask & (1 << i)) !== 0);
    const hours = selected.reduce((sum, task) => sum + task.hours, 0);
    if (hours > capacity) continue;
    const selectedIds = new Set(selected.map(task => task.id));
    const reward = selected.reduce((sum, task) => sum + task.reward, 0);
    const penalties = normalized
      .filter(task => !selectedIds.has(task.id) && task.deadlineToday)
      .reduce((sum, task) => sum + task.penalty, 0);
    results.push({
      selected: selected.map(task => task.id),
      hours,
      reward,
      penalties,
      net: reward - penalties
    });
  }
  return results.sort((a, b) =>
    b.net - a.net || a.hours - b.hours || a.selected.join(',').localeCompare(b.selected.join(','))
  );
}

function chooseBestPlan(tasks, capacity) {
  const plans = enumeratePlans(tasks, capacity);
  return plans[0] || null;
}

module.exports = { enumeratePlans, chooseBestPlan };
