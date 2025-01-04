// Importações principais
import Fastify from "fastify"
import fastifyJwt from "@fastify/jwt"
import fastifyCors from "@fastify/cors"
import fastifyPostgres from "@fastify/postgres"
import fastifyRateLimit from "@fastify/rate-limit"
import fastifyHelmet from "@fastify/helmet"
import { randomUUID } from "node:crypto"
import { hash, compare } from "bcrypt"
import QRCode from "qrcode"
import dotenv from "dotenv"

// Carregar variáveis de ambiente
dotenv.config()
console.log("⌛ Carregando variáveis de ambiente...")

// Configurações
const CONFIG = {
  PORTA: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || randomUUID(),
  DATABASE_URL: process.env.DATABASE_URL,
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  SALT_ROUNDS: 12,
  RATE_LIMIT: {
    max: 100,
    timeWindow: "15 minutes",
  },
}

// Queries SQL para criação das tabelas
const QUERIES_CRIACAO = {
  verificarTabelas: `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('administradores', 'ingressos');
    `,
  criarTabelaAdministradores: `
        CREATE TABLE IF NOT EXISTS administradores (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE NOT NULL,
            senha_hash VARCHAR(255) NOT NULL,
            tentativas_login INTEGER DEFAULT 0,
            bloqueado_ate TIMESTAMP,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `,
  criarTabelaIngressos: `
        CREATE TABLE IF NOT EXISTS ingressos (
            id UUID PRIMARY KEY,
            qr_code TEXT UNIQUE NOT NULL,
            status VARCHAR(20) NOT NULL,
            lote VARCHAR(50) NOT NULL,
            preco DECIMAL(10,2) NOT NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            pagamento_status BOOLEAN DEFAULT FALSE,
            pagamento_verificado_em TIMESTAMP,
            forma_pagamento VARCHAR(50),
            comprador_original_nome VARCHAR(100) NOT NULL,
            comprador_original_cpf VARCHAR(11) NOT NULL,
            comprador_original_rg VARCHAR(20) NOT NULL,
            comprador_original_telefone VARCHAR(20) NOT NULL,
            proprietario_atual_nome VARCHAR(100) NOT NULL,
            proprietario_atual_cpf VARCHAR(11) NOT NULL,
            proprietario_atual_rg VARCHAR(20) NOT NULL,
            proprietario_atual_telefone VARCHAR(20) NOT NULL,
            vendedor_id UUID REFERENCES administradores(id),
            observacoes TEXT,
            usado_em TIMESTAMP
        );
    `,
  criarIndices: `
        CREATE INDEX IF NOT EXISTS idx_ingressos_status ON ingressos(status);
        CREATE INDEX IF NOT EXISTS idx_ingressos_qr_code ON ingressos(qr_code);
        CREATE INDEX IF NOT EXISTS idx_ingressos_cpf ON ingressos(comprador_original_cpf);
    `,
}

// Criação do servidor Fastify
const servidor = Fastify({
  logger: true,
  trustProxy: true,
})

// Plugins e middlewares
async function registrarPlugins() {
  console.log("⌛ Registrando plugins...")
  try {
    // Segurança
    await servidor.register(fastifyHelmet)
    await servidor.register(fastifyRateLimit, CONFIG.RATE_LIMIT)

    // CORS
    await servidor.register(fastifyCors, {
      origin: process.env.FRONTEND_URL,
      credentials: process.env.CORS_CREDENTIALS === "true",
      methods: process.env.CORS_METHODS.split(","),
      allowedHeaders: process.env.CORS_HEADERS.split(","),
      maxAge: parseInt(process.env.SESSION_DURATION),
      exposedHeaders: process.env.CORS_HEADERS.split(","),
    })

    // JWT
    await servidor.register(fastifyJwt, {
      secret: CONFIG.JWT_SECRET,
    })

    // PostgreSQL
    await servidor.register(fastifyPostgres, {
      connectionString: CONFIG.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    })
    console.log("✅ Plugins registrados com sucesso")
  } catch (erro) {
    console.log("❌ Erro ao registrar plugins:", erro)
    throw erro
  }
}

// Função para verificar e criar tabelas
async function inicializarBancoDeDados() {
  console.log("⌛ Inicializando banco de dados...")
  try {
    const { rows: tabelasExistentes } = await servidor.pg.query(
      QUERIES_CRIACAO.verificarTabelas
    )
    const tabelasNecessarias = ["administradores", "ingressos"]

    for (const tabela of tabelasNecessarias) {
      if (!tabelasExistentes.some((row) => row.table_name === tabela)) {
        console.log(`⌛ Criando tabela: ${tabela}`)
        if (tabela === "administradores") {
          await servidor.pg.query(QUERIES_CRIACAO.criarTabelaAdministradores)
        } else if (tabela === "ingressos") {
          await servidor.pg.query(QUERIES_CRIACAO.criarTabelaIngressos)
        }
        console.log(`✅ Tabela ${tabela} criada com sucesso`)
      }
    }

    await servidor.pg.query(QUERIES_CRIACAO.criarIndices)
    console.log("✅ Índices criados com sucesso")

    await criarAdministradorMaster()
    console.log("✅ Banco de dados inicializado com sucesso")
  } catch (erro) {
    console.log("❌ Erro ao inicializar banco de dados:", erro)
    throw erro
  }
}

// Função para criar administrador master
async function criarAdministradorMaster() {
  if (!CONFIG.ADMIN_EMAIL || !CONFIG.ADMIN_PASSWORD) {
    console.log(
      "❌ Credenciais do administrador master não configuradas no .env"
    )
    return
  }

  try {
    const { rows } = await servidor.pg.query(
      "SELECT id FROM administradores WHERE email = $1",
      [CONFIG.ADMIN_EMAIL]
    )

    if (rows.length === 0) {
      const senhaHash = await hash(CONFIG.ADMIN_PASSWORD, CONFIG.SALT_ROUNDS)
      await servidor.pg.query(
        "INSERT INTO administradores (email, senha_hash) VALUES ($1, $2)",
        [CONFIG.ADMIN_EMAIL, senhaHash]
      )
      console.log("✅ Administrador master criado com sucesso")
    } else {
      console.log("✅ Administrador master já existe")
    }
  } catch (erro) {
    console.log("❌ Erro ao criar administrador master:", erro)
    throw erro
  }
}

// Rotas de autenticação
async function rotasAutenticacao() {
  servidor.post(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "senha"],
          properties: {
            email: { type: "string", format: "email" },
            senha: { type: "string", minLength: 8 },
          },
        },
      },
    },
    async (requisicao, resposta) => {
      const { email, senha } = requisicao.body
      try {
        if (email === CONFIG.ADMIN_EMAIL && senha === CONFIG.ADMIN_PASSWORD) {
          console.log("✅ Login bem-sucedido como administrador master")
          const token = servidor.jwt.sign(
            { id: "master", email: CONFIG.ADMIN_EMAIL },
            { expiresIn: "8h" }
          )
          return resposta.send({ sucesso: true, token })
        }

        const { rows } = await servidor.pg.query(
          "SELECT * FROM administradores WHERE email = $1",
          [email]
        )

        if (!rows[0]) {
          console.log("❌ Tentativa de login com email não cadastrado:", email)
          return resposta.code(401).send({
            sucesso: false,
            mensagem: "Credenciais inválidas",
          })
        }

        const admin = rows[0]
        const senhaCorreta = await compare(senha, admin.senha_hash)

        if (!senhaCorreta) {
          console.log("❌ Tentativa de login com senha incorreta para:", email)
          return resposta.code(401).send({
            sucesso: false,
            mensagem: "Credenciais inválidas",
          })
        }

        console.log("✅ Login bem-sucedido para:", email)
        const token = servidor.jwt.sign(
          { id: admin.id, email: admin.email },
          { expiresIn: "8h" }
        )
        return resposta.send({ sucesso: true, token })
      } catch (erro) {
        console.log("❌ Erro no processo de login:", erro)
        return resposta.code(500).send({
          sucesso: false,
          mensagem: "Erro interno do servidor",
        })
      }
    }
  )
}

// Middleware de autenticação (utilizado nas requisições)
async function autenticarRequisicao(requisicao, resposta) {
  try {
    await requisicao.jwtVerify()
    // Verificar se o token pertence a um admin válido
    const adminId = requisicao.user.id
    if (adminId === "master") return

    const { rows } = await servidor.pg.query(
      "SELECT id FROM administradores WHERE id = $1",
      [adminId]
    )

    if (!rows[0]) throw new Error("Admin não encontrado")
  } catch (erro) {
    resposta.code(401).send({
      sucesso: false,
      mensagem: "Não autorizado",
    })
  }
}

// Rotas de ingressos
async function rotasIngressos() {
  console.log("⌛ Registrando rotas de ingressos...")

  // Rota para obter estatísticas
  servidor.get(
    "/ingressos/estatisticas",
    {
      onRequest: [autenticarRequisicao],
    },
    async (requisicao, resposta) => {
      try {
        const { rows } = await servidor.pg.query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(preco) as receita_total,
                    SUM(CASE WHEN pagamento_status = true THEN preco ELSE 0 END) as receita_caixa
                FROM ingressos
                WHERE status != 'cancelado'
            `)

        return resposta.send({
          sucesso: true,
          total: parseInt(rows[0].total),
          receitaTotal: parseFloat(rows[0].receita_total) || 0,
          receitaCaixa: parseFloat(rows[0].receita_caixa) || 0,
        })
      } catch (erro) {
        console.log("❌ Erro ao obter estatísticas:", erro)
        return resposta.code(500).send({
          sucesso: false,
          mensagem: "Erro ao carregar estatísticas",
        })
      }
    }
  )

  // Rota para listar ingressos com paginação
  servidor.get(
    "/ingressos",
    {
      onRequest: [autenticarRequisicao],
      schema: {
        querystring: {
          type: "object",
          properties: {
            pagina: { type: "integer", minimum: 1, default: 1 },
            limite: { type: "integer", minimum: 1, maximum: 100, default: 10 },
          },
        },
      },
    },
    async (requisicao, resposta) => {
      try {
        const { pagina = 1, limite = 10 } = requisicao.query
        const offset = (pagina - 1) * limite

        // Consulta paginada
        const { rows: ingressos } = await servidor.pg.query(
          `
                SELECT 
                    i.id,
                    i.status,
                    i.lote,
                    i.preco,
                    i.criado_em,
                    i.pagamento_status,
                    i.pagamento_verificado_em,
                    i.forma_pagamento,
                    i.comprador_original_nome,
                    i.comprador_original_cpf,
                    i.proprietario_atual_nome,
                    i.proprietario_atual_cpf,
                    a.email as vendedor_nome
                FROM ingressos i
                LEFT JOIN administradores a ON i.vendedor_id = a.id
                ORDER BY i.criado_em DESC
                LIMIT $1 OFFSET $2
            `,
          [limite, offset]
        )

        // Contar total de registros
        const {
          rows: [{ total }],
        } = await servidor.pg.query("SELECT COUNT(*) as total FROM ingressos")

        return resposta.send({
          sucesso: true,
          dados: ingressos,
          total: parseInt(total),
          pagina,
          limite,
          totalPaginas: Math.ceil(total / limite),
        })
      } catch (erro) {
        console.log("❌ Erro ao listar ingressos:", erro)
        return resposta.code(500).send({
          sucesso: false,
          mensagem: "Erro ao carregar ingressos",
        })
      }
    }
  )

  // Rota para buscar detalhes de um ingresso específico
  servidor.get(
    "/ingressos/:id",
    {
      onRequest: [autenticarRequisicao],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (requisicao, resposta) => {
      try {
        const { rows } = await servidor.pg.query(
          "SELECT * FROM ingressos WHERE id = $1",
          [requisicao.params.id]
        )

        if (!rows[0]) {
          return resposta.code(404).send({
            sucesso: false,
            mensagem: "Ingresso não encontrado",
          })
        }

        return resposta.send({
          sucesso: true,
          ingresso: rows[0],
        })
      } catch (erro) {
        console.log("❌ Erro ao buscar ingresso:", erro)
        return resposta.code(500).send({
          sucesso: false,
          mensagem: "Erro ao buscar ingresso",
        })
      }
    }
  )

  console.log("✅ Rotas de ingressos registradas com sucesso")
}

// Inicialização do servidor
async function iniciarServidor() {
  try {
    const varaveisObrigatorias = [
      "DATABASE_URL",
      "JWT_SECRET",
      "ADMIN_EMAIL",
      "ADMIN_PASSWORD",
    ]
    const variaveisFaltando = varaveisObrigatorias.filter(
      (variavel) => !process.env[variavel]
    )

    if (variaveisFaltando.length > 0) {
      throw new Error(
        `❌ Variáveis de ambiente obrigatórias não configuradas: ${variaveisFaltando.join(", ")}`
      )
    }

    await registrarPlugins()
    await inicializarBancoDeDados()
    await rotasAutenticacao()
    await rotasIngressos()

    await servidor.listen({ port: CONFIG.PORTA, host: "0.0.0.0" })
    console.log(`✅ Servidor rodando na porta ${CONFIG.PORTA}`)
  } catch (erro) {
    console.log("❌ Erro fatal ao iniciar servidor:", erro)
    process.exit(1)
  }
}

// Tratamento de erros não capturados
process.on("unhandledRejection", (erro) => {
  console.log("❌ Erro não tratado:", erro)
  process.exit(1)
})

process.on("uncaughtException", (erro) => {
  console.log("❌ Exceção não capturada:", erro)
  process.exit(1)
})

// Iniciar servidor
iniciarServidor()
