# CHGT HelpDesk — versão local JSON

Aplicação de helpdesk executada somente no computador local. Ela não usa MySQL,
não se conecta a serviços externos e não contém dados reais.

## Executar

Requer Node.js 14 ou superior.

```bash
npm install
npm start
```

Abra `http://127.0.0.1:3000`. O servidor não fica acessível pela rede local.

### Acesso de demonstração

| E-mail | Senha |
| --- | --- |
| `admin@local.test` | `Admin123!` |

Selecione uma das unidades fictícias: Parnamirim/RN, Natal Centro ou Natal Zona
Norte. Esta é uma conta pública de demonstração; não a utilize em produção.

## Dados locais

O repositório versiona apenas `data/template.json`, que contém as três unidades
fictícias e a conta demo. No primeiro início, ele é copiado para
`data/local.json`. Todas as alterações feitas na aplicação são salvas nesse
arquivo local, que é ignorado pelo Git.

Para descartar os dados criados e voltar ao estado inicial:

```bash
npm run reset-local-data
```

Esse comando altera somente `data/local.json`. Ele não acessa, exporta, altera
ou remove qualquer banco MySQL existente no computador.

## Segurança e limites

- A aplicação usa bcrypt e JWT. Sem `JWT_SECRET`, é gerado um segredo aleatório
  a cada inicialização, invalidando sessões antigas.
- Notificações push e chaves VAPID foram removidas.
- O armazenamento JSON é destinado a execução local em processo único. Não é
  apropriado para múltiplas instâncias ou produção concorrente.

## Testes

```bash
npm test
```

Os testes usam um arquivo temporário e não modificam `data/local.json` nem
qualquer banco de dados local.
