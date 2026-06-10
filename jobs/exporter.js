/**
 * jobs/exporter.js — Export engine (V90-NEW-Y)
 * Exporta leads, finanças ou transações para CSV
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

function exportLeads() {
  const dbPath = path.join(__dirname, '..', 'data', 'leads.db');
  if (!fs.existsSync(dbPath)) return { error: 'Banco leads.db nao encontrado' };
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT id, domain, email, phone, score, resultado, ts FROM leads ORDER BY ts DESC').all();
  db.close();
  if (!rows.length) return { error: 'Nenhum lead encontrado' };
  
  const headers = 'id,domain,email,phone,score,resultado,ts\n';
  const csv = headers + rows.map(r => `${r.id},"${r.domain||''}","${r.email||''}","${r.phone||''}",${r.score||0},"${r.resultado||''}","${r.ts||''}"`).join('\n');
  return { csv, filename: 'leads_export.csv', count: rows.length };
}

function exportFin() {
  const dbPath = path.join(__dirname, '..', 'data', 'finance.db');
  if (!fs.existsSync(dbPath)) return { error: 'Banco finance.db nao encontrado' };
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT id, descricao, valor, tipo, ts FROM transactions ORDER BY ts DESC').all();
  db.close();
  if (!rows.length) return { error: 'Nenhuma transacao encontrada' };
  
  const headers = 'id,descricao,valor,tipo,ts\n';
  const csv = headers + rows.map(r => `${r.id},"${r.descricao||''}",${r.valor||0},"${r.tipo||''}","${r.ts||''}"`).join('\n');
  return { csv, filename: 'fin_export.csv', count: rows.length };
}

module.exports = { exportLeads, exportFin };
