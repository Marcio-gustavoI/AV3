/**
 * Conversão simples de resultados analíticos (JSON) para CSV (AV3 — Correção 4).
 */
export function converterParaCsv(dados: unknown): string {
  if (!dados || typeof dados !== 'object') {
    return '';
  }

  if (Array.isArray(dados)) {
    const linhas = dados.map((item, idx) => {
      const texto = typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item ?? '');
      return `"${idx}","${texto.replace(/"/g, '""')}"`;
    });
    return ['indice,valor', ...linhas].join('\n');
  }

  const obj = dados as Record<string, unknown>;
  const linhas = Object.entries(obj).map(([chave, valor]) => {
    const texto =
      typeof valor === 'object' && valor !== null ? JSON.stringify(valor) : String(valor ?? '');
    return `"${chave.replace(/"/g, '""')}","${texto.replace(/"/g, '""')}"`;
  });
  return ['chave,valor', ...linhas].join('\n');
}
