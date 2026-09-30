# FinanzIA

Aplicação de educação financeira para organizar gastos mensais e planejar metas de economia. Os dados são inseridos manualmente, sem conexão com contas bancárias ou Open Finance.

## Tecnologias utilizadas

| Tecnologia | Uso no projeto |
| --- | --- |
| TypeScript | Tipagem e lógica da aplicação e do servidor. |
| React | Componentes e interface do usuário. |
| Vite | Ambiente de desenvolvimento e build do frontend. |
| CSS e Tailwind CSS | Estilização, responsividade e temas. |
| React Router | Navegação entre páginas. |
| Node.js | Servidor da API de orientações. |
| Gemini API e SDK `@google/genai` | Geração opcional de orientações personalizadas. |
| dotenv | Carregamento das variáveis de ambiente do servidor. |
| Lucide React | Ícones da interface. |
| ESLint e Prettier | Análise e formatação do código. |
| pnpm | Gerenciamento das dependências. |
| Node Test Runner | Testes automatizados de validação e novas tentativas. |

## Funcionalidades

- Cadastro de renda e inclusão, edição e exclusão de despesas por categoria.
- Definição de uma meta com valor desejado, quantia já guardada e prazo.
- Resumo do saldo mensal, distribuição dos gastos e planejamento da meta.
- Orientações locais e análise opcional com IA, em linguagem simples.
- Caixa de leitura com opção de copiar a análise gerada.
- Temas claro e escuro, interface responsiva e exportação dos dados em JSON.
- Armazenamento da simulação no navegador.

## Como executar

É necessário ter Node.js compatível com as dependências e com a execução de TypeScript pelo comando `--experimental-strip-types`, além do pnpm.

Na raiz do projeto, instale as dependências:

```bash
pnpm install --frozen-lockfile
```

Para habilitar as orientações do Gemini, crie um arquivo `.env` na mesma pasta do `package.json`:

```dotenv
GEMINI_API_KEY=sua_chave_aqui
GEMINI_MODEL=modelo_permitido_pelo_servidor
AI_INSIGHTS_ENABLED=true
PORT=8787
```

Substitua os valores de exemplo. O modelo precisa estar disponível para sua chave e constar em `SUPPORTED_MODELS`, no arquivo `server/advice.ts`. Para usar somente as orientações locais, mantenha `AI_INSIGHTS_ENABLED=false`; a chave não é necessária nesse modo.

Inicie o frontend:

```bash
pnpm dev
```

Em outro terminal, na mesma pasta, inicie o backend:

```bash
pnpm dev:server
```

Abra o endereço informado pelo Vite. O proxy de desenvolvimento aponta para a porta `8787`; caso altere a porta do backend, ajuste também `vite.config.ts`. Reinicie o backend após modificar suas variáveis de ambiente.

## Verificações e build

```bash
pnpm lint
node --experimental-strip-types --test tests/*.test.ts
pnpm build
```

Os testes utilizam respostas simuladas, sem consumir a API do Gemini. O build inclui a verificação de tipos e gera o frontend em `dist`.

Use `pnpm preview` para conferir o frontend compilado localmente. Esse comando não inicia o backend. Em produção, execute o servidor Node separadamente e configure o encaminhamento de `/api` para ele; o proxy de desenvolvimento não acompanha os arquivos de `dist`.

## Regras da simulação

- Campos monetários aceitam de **R$ 50,00 a R$ 1.000.000,00**, com até duas casas decimais. Esse limite não se aplica aos resultados calculados.
- Descrições de despesas exigem pelo menos **20 caracteres**, permitindo letras, inclusive acentuadas, números e espaços.
- Os cálculos usam centavos e consideram renda e despesas constantes, sem rendimentos.
- O saldo disponível não é considerado automaticamente dinheiro já guardado.

## Privacidade e integração com IA

A simulação fica no `localStorage` do navegador. A orientação externa depende do consentimento e da solicitação do usuário. O servidor envia ao Gemini um resumo dos valores e categorias, sem descrições das despesas ou nome da meta.

A chave do Gemini deve permanecer no backend. Não a coloque no frontend, em variáveis `VITE_*`, em logs ou em commits. O `.env` e suas variantes privadas são ignorados pelo Git.

O servidor valida as respostas e aplica limites de requisição. Quando a IA está indisponível, a aplicação mantém as dicas locais ou a última análise válida da mesma simulação. As orientações têm finalidade educativa e podem conter erros.

```
💻 Desenvolvido por Gabriel Moreira

👨‍🎓 Estudante de Ciência da Computação; Desenvolvedor Web com experiência em JavaScript, TypeScript, React e Python.

🛠️ Este projeto foi desenvolvido para fins educacionais como parte de um projeto extracurricular...
```