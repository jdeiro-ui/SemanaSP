# SemanaSP — Despesas de Viagem

App simples para controlar as despesas semanais de viagens a trabalho. Funciona no
celular e no computador, pode ser instalado na tela inicial (PWA) e funciona offline.

## Funcionalidades

- **Visão por semana** (segunda a domingo), com navegação entre semanas
- **Lançamento rápido**: valor, data, categoria, descrição, cidade e forma de pagamento
- **Leitura de prints**: compartilhe o print de uma corrida da Uber ou de um pedido do
  Keeta (ou use o botão 📷) e a despesa é preenchida sozinha — trajeto da corrida,
  restaurante do pedido, valor e data. A leitura (OCR) roda no próprio aparelho
- **Categorias**: hospedagem, alimentação, transporte, combustível, passagem, outros
- **Hospedagem com check-in e check-out**: o valor é distribuído por noite, e uma
  estadia que atravessa semanas entra em cada semana só com as suas noites
- **Passagem com ida, volta, data da compra, companhia aérea e localizador**: conta na
  semana da viagem (metade na ida, metade na volta), não na semana da compra
- **Formas de pagamento**: Nubank, Unlimited, Ticket e Pix/dinheiro, com total por forma;
  Nubank e Unlimited permitem informar parcelas (só daquela despesa)
- **Reembolso**: marque o que a empresa deve reembolsar e veja o total a receber
- **Local**: Rio de Janeiro e São Paulo com um toque, ou digite outro
- **Orçamento semanal** opcional, com alerta quando é ultrapassado
- **Gráficos** por categoria e por dia da semana
- **Análises**: gasto realizado e agendado, média por mês e por viagem, gasto mês a
  mês por categoria, médias por categoria (inclusive hospedagem por noite) e resumo por ano
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
| `receipt.js` | Interpretação do texto lido dos prints (Uber, Keeta) |
| `app.js` | Interação, armazenamento, exportação |
| `stats.js` | Aba Análises (indicadores, gráfico mensal, tabelas) |
| `sw.js`, `manifest.webmanifest` | Funcionamento offline e instalação |
