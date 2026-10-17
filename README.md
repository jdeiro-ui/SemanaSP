# SemanaSP — Despesas de Viagem

App simples para controlar as despesas semanais de viagens a trabalho. Funciona no
celular e no computador, pode ser instalado na tela inicial (PWA) e funciona offline.

## Funcionalidades

- **Visão por semana** (segunda a domingo), com navegação entre semanas
- **Lançamento rápido**: valor, data, categoria, descrição, cidade e forma de pagamento
- **Categorias**: hospedagem, alimentação, transporte, combustível, passagem, outros
- **Separação do dinheiro**: o que saiu do seu bolso, o que a empresa deve reembolsar
  e o que foi pago no cartão corporativo
- **Orçamento semanal** opcional, com alerta quando é ultrapassado
- **Gráficos** por categoria e por dia da semana
- **Exportar CSV** da semana (abre direto no Excel) para a prestação de contas
- **Backup/restauração** em JSON

Os dados ficam salvos só no navegador do aparelho (`localStorage`). Use o backup
para levar os dados para outro aparelho ou não perdê-los.

## Como usar

Rode um servidor local na pasta do projeto:

```bash
npm start            # ou: python3 -m http.server 8080
```

Abra http://localhost:8080. Para usar no celular, publique a pasta em qualquer
hospedagem estática (ex.: GitHub Pages) e use "Adicionar à tela inicial".

## Testes

```bash
npm test
```

## Estrutura

| Arquivo | Conteúdo |
| --- | --- |
| `index.html` | Interface |
| `styles.css` | Estilos (tema claro/escuro automático) |
| `calc.js` | Regras: semanas, valores, totais, CSV |
| `app.js` | Interação, armazenamento, exportação |
| `sw.js`, `manifest.webmanifest` | Funcionamento offline e instalação |
