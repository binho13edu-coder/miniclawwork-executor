const { parentPort } = require('worker_threads');
const { triggerAndWait } = require('./index.js'); // isso causaria recursão
// Melhor: passar o código como parâmetro e executar a função importada
// Mas para simplificar, vamos redefinir a lógica dentro do worker
// Porém, o correto é mover triggerAndWait para um módulo separado.
// Vamos fazer um patch mais simples: usar setTimeout para não bloquear
