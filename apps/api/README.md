# OpsPilot API

NestJS backend for the OpsPilot fleet operations copilot. It demonstrates prompt engineering, deterministic embeddings, semantic search, retrieval-augmented generation (RAG), routing, summarization, structured incident classification, and provider fallback without requiring an API key.

## Run locally

From the repository root:

```bash
pnpm install
pnpm --filter @opspilot/api dev
```

The API listens on `http://localhost:4000`. Interactive OpenAPI documentation is available at `http://localhost:4000/api/docs`.

The default `AI_PROVIDER=local` path is deterministic, has no external runtime service dependency, and works offline. Copy `.env.example` to `.env` only when you want to change configuration.

## Endpoints

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | API, model adapter, and index health |
| `GET` | `/api/overview` | Fleet KPIs, daily brief, trend, incident feed, AI health |
| `GET` | `/api/incidents` | Synthetic incident feed and severity rollups |
| `GET` | `/api/documents` | Indexed knowledge articles |
| `POST` | `/api/ai/chat` | Routed, grounded copilot response with citations and trace |
| `GET` | `/api/ai/search?q=...&scope=all` | Semantic search over incidents and/or knowledge |
| `POST` | `/api/ai/classify` | Category, severity, escalation, and recommended action |

Example:

```bash
curl -s http://localhost:4000/api/ai/chat \
  -H 'content-type: application/json' \
  -d '{"message":"What should I do about the brake alert on VH-2047?"}'
```

All request DTOs are validated with allow-listed properties and size bounds. CORS accepts `WEB_ORIGIN` as a comma-separated list.

## AI architecture

The corpus contains eight fleet policies and eight realistic incidents. Each becomes a source-attributed retrieval chunk.

1. `AiRouterService` selects one of `KNOWLEDGE_QUERY`, `INCIDENT_SEARCH`, `SUMMARY`, `DATABASE_QUERY`, or `GENERAL` using deterministic, testable intent rules.
2. `LocalEmbeddingService` canonicalizes fleet synonyms, hashes tokens/bigrams/character trigrams into a normalized 256-dimensional vector, and ranks chunks using cosine similarity plus lexical/title overlap.
3. `RetrievalService` enforces the requested scope, reranks results, and exposes citations with stable IDs and metadata.
4. `AiService` builds an injection-resistant grounded prompt, generates an answer, and returns an observable trace with timing and model information.
5. `ClassificationService` supplies a deterministic safety-first classifier, with optional remote JSON classification through the same provider boundary.

Prompt templates in `src/ai/prompts.ts` show role prompting, explicit constraints, few-shot intent examples, source boundaries, uncertainty behavior, prompt-injection isolation, and a concise output contract.

## OpenAI, LangChain, and AWS Bedrock

The local adapter is always the safe fallback. Remote calls are used only when `AI_PROVIDER` explicitly selects a configured provider.

### OpenAI

```dotenv
AI_PROVIDER=openai
AI_ALLOW_FALLBACK=true
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

The OpenAI embedding adapter lazily imports and uses LangChain's genuine `OpenAIEmbeddings` integration. Grounded generation uses the official OpenAI SDK Responses API. This keeps the LangChain integration visible and useful while avoiding any network or credential requirement on the default path.

`OPENAI_GENERATION_MODEL` is accepted as an alias for `OPENAI_MODEL`.

### AWS Bedrock

```dotenv
AI_PROVIDER=aws
AI_ALLOW_FALLBACK=true
AWS_REGION=us-east-1
AWS_BEDROCK_MODEL_ID=amazon.nova-lite-v1:0
AWS_BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
AWS_BEDROCK_EMBEDDING_DIMENSIONS=1024
```

AWS uses the official AWS SDK for JavaScript v3. Grounded generation is sent with `BedrockRuntimeClient` and `ConverseCommand`. Embeddings are sent one text at a time with `InvokeModelCommand` using Titan Text Embeddings V2's `inputText`, `dimensions`, and `normalize: true` request fields. Supported dimensions are `256`, `512`, and `1024`; invalid or absent values default to `1024`.

Do not add credentials to the application configuration. `BedrockRuntimeClient` uses the standard AWS SDK credential chain, including local shared profiles, environment credentials, ECS task roles, and EC2 instance roles. The selected identity needs `bedrock:InvokeModel` permission for the configured generation and embedding models.

Provider errors, timeouts, incomplete embeddings, and empty generations fall back to local behavior when `AI_ALLOW_FALLBACK=true` (the default). Set it to `false` when a hosted-provider failure should fail the request instead. Keys and provider payloads are never returned to clients, and traces report `local`, `openai`, or `aws` accurately.

Both the repository-level `.env` and `apps/api/.env` are loaded on startup. Existing shell or container variables take precedence, followed by the repository file and then the API-specific file.

## Quality checks

```bash
pnpm --filter @opspilot/api typecheck
pnpm --filter @opspilot/api lint
pnpm --filter @opspilot/api test
pnpm --filter @opspilot/api test:e2e
pnpm --filter @opspilot/api build
```

The focused unit suite covers intent routing, retrieval relevance/scope/determinism, and safety classification. The HTTP suite verifies health, overview, search, chat contracts, classification, and DTO rejection behavior.
