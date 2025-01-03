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
  // Segurança
  await servidor.register(fastifyHelmet)
  await servidor.register(fastifyRateLimit, CONFIG.RATE_LIMIT)

  // CORS
  await servidor.register(fastifyCors, {
    origin: CONFIG.FRONTEND_URL,
    credentials: true,
  })

  // JWT
  await servidor.register(fastifyJwt, {
    secret: CONFIG.JWT_SECRET,
  })

  // PostgreSQL
  await servidor.register(fastifyPostgres, {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  })
}

// Verificar e criar tabelas no Banco de Dados
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
      "❌ Credenciais do administrador master não configuradas no .env!"
    )
    return
  }

  try {
    const { rows } = await servidor.pg.query(
      "SELECT id FROM administradores WHERE email = $1",
      [CONFIG.ADMIN_EMAIL]
    )

    if (rows.length === 0) {
      console.log("⌛ Criando administrador master no Banco de Dados...")
      const senhaHash = await hash(CONFIG.ADMIN_PASSWORD, CONFIG.SALT_ROUNDS)
      await servidor.pg.query(
        "INSERT INTO administradores (email, senha_hash) VALUES ($1, $2)",
        [CONFIG.ADMIN_EMAIL, senhaHash]
      )
      console.log(
        "✅ Administrador master inserido com sucesso no Banco de Dados!"
      )
    } else {
      console.log("✅ Administrador Master já consta o Banco de Daods!")
    }
  } catch (erro) {
    console.log("❌ Erro ao criar administrador master:", erro)
    throw erro
  }
}

// Rota de login
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
        // Primeiro, verificar se é o admin master
        if (email === CONFIG.ADMIN_EMAIL && senha === CONFIG.ADMIN_PASSWORD) {
          console.log("✅ Login bem-sucedido como administrador master")
          const token = servidor.jwt.sign(
            { id: "master", email: CONFIG.ADMIN_EMAIL },
            { expiresIn: "8h" }
          )
          return resposta.send({ sucesso: true, token })
        }

        // Se não for admin master, verificar no banco
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

// Inicialização do servidor
async function iniciarServidor() {
  try {
    // Verificar variáveis de ambiente obrigatórias
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

    // Registrar plugins
    await registrarPlugins()

    // Inicializar banco de dados
    await inicializarBancoDeDados()

    // Registrar rotas
    await rotasAutenticacao()
    await rotasIngressos()

    // Iniciar servidor
    await servidor.listen({ port: CONFIG.PORTA, host: "0.0.0.0" })
    servidor.log.info(`Servidor rodando na porta ${CONFIG.PORTA}`)
  } catch (erro) {
    servidor.log.error("Erro fatal ao iniciar servidor:", erro)
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
