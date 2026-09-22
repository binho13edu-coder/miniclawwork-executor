const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enumeratePlans, chooseBestPlan } = require('../core/decision-verifier');

const tasks = [
  { id: 'A', hours: 2, reward: 300, deadlineToday: true, penalty: 300 },
  { id: 'B', hours: 3, reward: 500, deadlineToday: true, penalty: 500 },
  { id: 'C', hours: 2, reward: 350, deadlineToday: false, penalty: 0 },
  { id: 'D', hours: 1, reward: 250, deadlineToday: true, penalty: 250 }
];

test('enumera planos viáveis e inclui multas pendentes', () => {
  const plans = enumeratePlans(tasks, 5);
  const ab = plans.find(plan => plan.selected.join(',') === 'A,B');
  const bd = plans.find(plan => plan.selected.join(',') === 'B,D');
  assert.deepEqual(ab, { selected: ['A', 'B'], hours: 5, reward: 800, penalties: 250, net: 550 });
  assert.equal(bd.net, 450);
});

test('escolhe o maior líquido, não apenas a maior receita', () => {
  assert.deepEqual(chooseBestPlan(tasks, 5), {
    selected: ['A', 'B'], hours: 5, reward: 800, penalties: 250, net: 550
  });
});
