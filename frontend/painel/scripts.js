// Configurações
const CONFIG = {
  API_URL: "https://jpass.onrender.com",
  INTERVALO_ATUALIZACAO: 30000, // 30 segundos
  FORMATO_MOEDA: {
    style: "currency",
    currency: "BRL",
  },
  FORMATO_DATA: {
    dateStyle: "short",
    timeStyle: "short",
  },
}

// Classe principal do painel administrativo
class PainelAdmin {
  constructor() {
    this.verificarAutenticacao()
    this.inicializarElementos()
    this.inicializar()
  }

  verificarAutenticacao() {
    const token = sessionStorage.getItem("authToken")
    if (!token) {
      window.location.href = "/login/"
      return false
    }
    this.token = token
    return true
  }

  inicializarElementos() {
    // Cache de elementos DOM
    this.elementos = {
      nomeAdmin: document.getElementById("nomeAdmin"),
      totalIngressos: document.getElementById("totalIngressos"),
      receitaTotal: document.getElementById("receitaTotal"),
      receitaCaixa: document.getElementById("receitaCaixa"),
      corpoTabela: document.getElementById("corpoTabela"),
      paginaAtual: document.getElementById("paginaAtual"),
      totalPaginas: document.getElementById("totalPaginas"),
      paginaAnterior: document.getElementById("paginaAnterior"),
      proximaPagina: document.getElementById("proximaPagina"),
      botaoSair: document.getElementById("botaoSair"),
      modalLoading: document.getElementById("modalLoading"),
    }
  }

  async inicializar() {
    if (!this.verificarAutenticacao()) {
      return
    }

    try {
      this.inicializarEventos()
      await this.carregarDados()
      this.iniciarAtualizacaoAutomatica()
    } catch (erro) {
      this.tratarErro(erro)
    }
  }

  inicializarEventos() {
    // Eventos de paginação
    this.elementos.paginaAnterior.addEventListener("click", () =>
      this.mudarPagina("anterior")
    )
    this.elementos.proximaPagina.addEventListener("click", () =>
      this.mudarPagina("proxima")
    )

    // Evento de logout
    this.elementos.botaoSair.addEventListener("click", () =>
      this.realizarLogout()
    )

    // Atualização ao voltar à página
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.carregarDados()
      }
    })
  }

  tratarErro(erro) {
    console.error("Erro:", erro)
    this.mostrarLoading(false)

    if (erro.message === "Sessão expirada") {
      this.realizarLogout()
      return
    }

    // Implementar notificação visual do erro
    alert("Erro ao carregar dados. Por favor, tente novamente.")
  }

  async carregarDados() {
    this.mostrarLoading(true)
    try {
      const [estatisticas, ingressos] = await Promise.all([
        this.carregarEstatisticas(),
        this.carregarIngressos(),
      ])

      this.atualizarInterface(estatisticas, ingressos)
    } catch (erro) {
      this.tratarErro(erro)
    } finally {
      this.mostrarLoading(false)
    }
  }

  async carregarEstatisticas() {
    const resposta = await this.realizarRequisicao("/ingressos/estatisticas")
    return resposta
  }

  async carregarIngressos(pagina = 1) {
    const resposta = await this.realizarRequisicao(
      `/ingressos?pagina=${pagina}&limite=10`
    )
    return resposta
  }

  async realizarRequisicao(endpoint) {
    try {
      const resposta = await fetch(`${CONFIG.API_URL}${endpoint}`, {
        method: "GET",
        mode: "cors",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
      })

      if (!resposta.ok) {
        if (resposta.status === 401) {
          this.realizarLogout()
          throw new Error("Sessão expirada")
        }
        throw new Error(`Erro HTTP: ${resposta.status}`)
      }

      const dados = await resposta.json()
      if (!dados.sucesso) {
        throw new Error(dados.mensagem || "Erro na requisição")
      }

      return dados
    } catch (erro) {
      console.error("Erro na requisição:", erro)
      this.tratarErro(erro)
      throw erro
    }
  }

  atualizarInterface(estatisticas, ingressos) {
    // Atualizar estatísticas
    this.elementos.totalIngressos.textContent = estatisticas.total
    this.elementos.receitaTotal.textContent = this.formatarMoeda(
      estatisticas.receitaTotal
    )
    this.elementos.receitaCaixa.textContent = this.formatarMoeda(
      estatisticas.receitaCaixa
    )

    // Atualizar tabela
    this.atualizarTabela(ingressos.dados)

    // Atualizar paginação
    this.atualizarPaginacao(ingressos)
  }

  atualizarTabela(ingressos) {
    this.elementos.corpoTabela.innerHTML = ingressos
      .map(
        (ingresso) => `
            <tr>
                <td>${this.formatarId(ingresso.id)}</td>
                <td><span class="status status-${
                  ingresso.status
                }">${this.traduzirStatus(ingresso.status)}</span></td>
                <td>${ingresso.lote}</td>
                <td>${this.formatarMoeda(ingresso.preco)}</td>
                <td>${this.formatarData(ingresso.criado_em)}</td>
                <td>${ingresso.pagamento_status ? "Pago" : "Pendente"}</td>
                <td>${ingresso.comprador_original_nome}</td>
                <td>${this.formatarCPF(ingresso.comprador_original_cpf)}</td>
                <td>${ingresso.proprietario_atual_nome}</td>
                <td>${this.formatarCPF(ingresso.proprietario_atual_cpf)}</td>
                <td>${ingresso.vendedor_nome}</td>
                <td>
                    <button onclick="painelAdmin.visualizarIngresso('${
                      ingresso.id
                    }')" class="botao-acao">
                        Visualizar
                    </button>
                </td>
            </tr>
        `
      )
      .join("")
  }

  atualizarPaginacao(dados) {
    this.elementos.paginaAtual.textContent = dados.pagina
    this.elementos.totalPaginas.textContent = dados.totalPaginas
    this.elementos.paginaAnterior.disabled = dados.pagina <= 1
    this.elementos.proximaPagina.disabled = dados.pagina >= dados.totalPaginas
  }

  // Utilitários
  formatarMoeda(valor) {
    return new Intl.NumberFormat("pt-BR", CONFIG.FORMATO_MOEDA).format(valor)
  }

  formatarData(data) {
    return new Intl.DateTimeFormat("pt-BR", CONFIG.FORMATO_DATA).format(
      new Date(data)
    )
  }

  formatarCPF(cpf) {
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
  }

  formatarId(id) {
    return id.substring(0, 8) + "..."
  }

  traduzirStatus(status) {
    const traducoes = {
      pending: "Pendente",
      paid: "Pago",
      used: "Usado",
      cancelled: "Cancelado",
    }
    return traducoes[status] || status
  }

  mostrarLoading(mostrar) {
    this.elementos.modalLoading.hidden = !mostrar
  }

  tratarErro(erro) {
    console.error("Erro:", erro)
    // Implementar sistema de notificação para o usuário
  }

  realizarLogout() {
    sessionStorage.removeItem("authToken")
    window.location.href = "/login/"
  }

  iniciarAtualizacaoAutomatica() {
    setInterval(() => {
      if (document.visibilityState === "visible") {
        this.carregarDados()
      }
    }, CONFIG.INTERVALO_ATUALIZACAO)
  }
}

// Inicialização segura
document.addEventListener("DOMContentLoaded", () => {
  window.painelAdmin = new PainelAdmin()
})
