# QuantoGastei? — Despesas de Viagem

App simples para controlar as despesas semanais de viagens a trabalho (antes chamado SemanaSP). Funciona no
celular e no computador, pode ser instalado na tela inicial (PWA) e funciona offline.

## Funcionalidades

- **Visão por semana** (segunda a domingo), com navegação entre semanas
- **Lançamento rápido**: valor, data, categoria, descrição, cidade e forma de pagamento
- **Leitura de prints**: compartilhe o print de uma corrida da Uber, de um pedido do
  Keeta, de um SMS de compra no cartão ou da Carteira do Google (ou use o botão 📷) e a despesa é preenchida
  sozinha — trajeto, restaurante/estabelecimento, valor, data, parcelas e um palpite de
  categoria. A leitura (OCR) roda no próprio aparelho
- **Categorias personalizáveis**: hospedagem, alimentação, transporte, passagem e outros
  podem ser renomeadas, trocar de ícone ou ser ocultadas; dá para criar novas (⚙️)
- **Hospedagem com check-in e check-out**: o valor é distribuído por noite, e uma
  estadia que atravessa semanas entra em cada semana só com as suas noites
- **Passagem com ida, volta, data da compra, companhia aérea e localizador**: conta na
  semana da viagem (metade na ida, metade na volta), não na semana da compra
- **Formas de pagamento**: cartão de crédito (com parcelas, só daquela despesa), Ticket e
  Pix/dinheiro, com total por forma
- **Reembolso**: marque o que a empresa deve reembolsar e veja o total a receber
- **Local**: Rio de Janeiro e São Paulo com um toque, ou digite outro; a cidade pode ser
  marcada automaticamente pela localização do celular (desligável nas configurações)
- **Ocultar valores** (👁️ no topo): troca os valores da tela por "R$ •••" para mostrar o app
- **Orçamento semanal** opcional, com alerta quando é ultrapassado
- **Gráficos** por categoria e por dia da semana
- **Análises**: gasto realizado e agendado, média por mês e por viagem, gasto mês a
  mês por categoria, médias por categoria (inclusive hospedagem por noite) e resumo por ano
- **Orçado x realizado**: cada semana de viagem encerrada comparada ao orçamento semanal,
  com saldo do período e por mês
- **Quadros recolhíveis**: toque no título de um quadro para recolher/expandir
- **Exportar CSV** da semana (abre direto no Excel) para a prestação de contas
- **Backup na nuvem** (Firebase): com login Google, cada mudança vai para o Firestore
  e os aparelhos ficam sincronizados; funciona offline e envia quando a conexão volta
- **Importar planilha** (.xlsx, .xls ou .csv): o app sugere as colunas e a tradução de
  categorias e formas de pagamento, mostra uma prévia e acrescenta as despesas sem apagar
  nada; reimportar o mesmo arquivo não duplica. A leitura roda no aparelho
- **Backup/restauração** em JSON e **importação** de arquivo JSON que acrescenta despesas

Os dados ficam salvos no navegador do aparelho (`localStorage`) e, com o backup na
nuvem ativo, também em `users/{uid}/expenses` no Firestore do projeto configurado em
`firebase-config.js`.

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
| `receipt.js` | Interpretação do texto lido dos prints (Uber, Keeta, SMS de cartão, Carteira do Google) |
| `importer.js`, `import-ui.js` | Importação de planilhas (regras e tela) |
| `app.js` | Interação, armazenamento, exportação |
| `stats.js` | Aba Análises (indicadores, gráfico mensal, tabelas) |
| `sync.js`, `firebase-config.js` | Backup e sincronização na nuvem (Firebase) |
| `sw.js`, `manifest.webmanifest` | Funcionamento offline e instalação |
