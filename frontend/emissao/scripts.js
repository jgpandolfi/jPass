// Configurações
const CONFIG = {
  API_URL: "http://localhost:3000",
  LOTES: [
    { id: "lote1", nome: "1º Lote", preco: 50.0 },
    { id: "lote2", nome: "2º Lote", preco: 60.0 },
    { id: "lote3", nome: "3º Lote", preco: 70.0 },
    { id: "lote4", nome: "Lote Extra", preco: 80.0 },
  ],
  FORMATO_MOEDA: {
    style: "currency",
    currency: "BRL",
  },
  FORMATO_DATA: {
    dateStyle: "short",
    timeStyle: "short",
  },
}

// Classe principal de emissão de ingressos
class EmissorIngressos {
  constructor() {
    // Cache de elementos DOM
    this.elementos = {
      formEmissao: document.getElementById("formEmissao"),
      secaoFormulario: document.getElementById("secaoFormulario"),
      secaoResultado: document.getElementById("secaoResultado"),
      modalLoading: document.getElementById("modalLoading"),
      botaoVoltar: document.getElementById("botaoVoltar"),
      botaoImprimir: document.getElementById("botaoImprimir"),
      botaoNovoIngresso: document.getElementById("botaoNovoIngresso"),
      selectLote: document.getElementById("loteIngresso"),
      inputCPF: document.getElementById("cpfComprador"),
      inputTelefone: document.getElementById("telefoneComprador"),
    }

    // Estado da aplicação
    this.estado = {
      dadosAdmin: null,
      emissaoEmProgresso: false,
    }

    this.inicializar()
  }

  async inicializar() {
    try {
      // Verificar autenticação
      if (!this.verificarAutenticacao()) {
        window.location.href = "../login/login.html"
        return
      }

      // Carregar dados do admin
      await this.carregarDadosAdmin()

      // Inicializar eventos
      this.inicializarEventos()

      // Carregar lotes
      this.carregarLotes()

      // Inicializar máscaras
      this.inicializarMascaras()
    } catch (erro) {
      this.tratarErro(erro)
    }
  }

  inicializarEventos() {
    // Form principal
    this.elementos.formEmissao.addEventListener("submit", (e) =>
      this.emitirIngresso(e)
    )

    // Botões de navegação
    this.elementos.botaoVoltar.addEventListener("click", () =>
      this.voltarAoPainel()
    )
    this.elementos.botaoNovoIngresso.addEventListener("click", () =>
      this.prepararNovoIngresso()
    )
    this.elementos.botaoImprimir.addEventListener("click", () =>
      this.imprimirIngresso()
    )

    // Select de lote
    this.elementos.selectLote.addEventListener("change", () =>
      this.atualizarPrecoLote()
    )
  }

  // Inicialização de Componentes
  carregarLotes() {
    const select = this.elementos.selectLote
    CONFIG.LOTES.forEach((lote) => {
      const option = document.createElement("option")
      option.value = lote.id
      option.textContent = `${lote.nome} - ${this.formatarMoeda(lote.preco)}`
      select.appendChild(option)
    })
  }

  inicializarMascaras() {
    // Máscara CPF
    this.elementos.inputCPF.addEventListener("input", (e) => {
      let valor = e.target.value.replace(/\D/g, "")
      if (valor.length > 11) valor = valor.slice(0, 11)
      e.target.value = valor
    })

    // Máscara Telefone
    this.elementos.inputTelefone.addEventListener("input", (e) => {
      let valor = e.target.value.replace(/\D/g, "")
      if (valor.length > 11) valor = valor.slice(0, 11)
      if (valor.length > 2) valor = `(${valor.slice(0, 2)}) ${valor.slice(2)}`
      if (valor.length > 10) valor = `${valor.slice(0, 10)}-${valor.slice(10)}`
      e.target.value = valor
    })
  }

  // Emissão de Ingresso
  async emitirIngresso(evento) {
    evento.preventDefault()
    if (this.estado.emissaoEmProgresso) return

    try {
      this.estado.emissaoEmProgresso = true
      this.mostrarLoading(true)

      // Coletar dados do formulário
      const dadosIngresso = this.coletarDadosFormulario()

      // Validar dados
      if (!this.validarDados(dadosIngresso)) {
        throw new Error("Dados inválidos")
      }

      // Enviar para o servidor
      const ingressoGerado = await this.enviarDadosIngresso(dadosIngresso)

      // Mostrar resultado
      this.mostrarResultadoEmissao(ingressoGerado)
    } catch (erro) {
      this.tratarErro(erro)
    } finally {
      this.estado.emissaoEmProgresso = false
      this.mostrarLoading(false)
    }
  }

  coletarDadosFormulario() {
    const formData = new FormData(this.elementos.formEmissao)
    const loteSelecionado = CONFIG.LOTES.find(
      (l) => l.id === formData.get("loteIngresso")
    )

    return {
      lote: loteSelecionado.nome,
      preco: loteSelecionado.preco,
      pagamentoEfetuado: formData.get("pagamentoEfetuado") === "sim",
      formaPagamento: formData.get("formaPagamento"),
      compradorNome: formData.get("nomeComprador"),
      compradorCPF: formData.get("cpfComprador"),
      compradorRG: formData.get("rgComprador"),
      compradorTelefone: formData.get("telefoneComprador"),
      vendedorNome: formData.get("nomeVendedor"),
      observacoes: formData.get("observacoes"),
    }
  }

  validarDados(dados) {
    // Implementar validações específicas
    return true
  }

  async enviarDadosIngresso(dados) {
    const resposta = await this.realizarRequisicao("/ingressos", {
      method: "POST",
      body: JSON.stringify(dados),
    })

    if (!resposta.sucesso) {
      throw new Error(resposta.mensagem || "Erro ao gerar ingresso")
    }

    return resposta.ingresso
  }

  mostrarResultadoEmissao(ingresso) {
    // Atualizar QR Code
    document.getElementById("qrCode").src = ingresso.qrCode

    // Atualizar informações
    document.getElementById("idIngresso").textContent = ingresso.id
    document.getElementById("dataEmissao").textContent = this.formatarData(
      ingresso.criadoEm
    )
    document.getElementById("loteInfo").textContent = ingresso.lote
    document.getElementById("precoInfo").textContent = this.formatarMoeda(
      ingresso.preco
    )
    document.getElementById("proprietarioInfo").textContent =
      ingresso.proprietarioAtualNome
    document.getElementById("cpfInfo").textContent = this.formatarCPF(
      ingresso.proprietarioAtualCPF
    )
    document.getElementById("vendedorInfo").textContent = ingresso.vendedorNome
    document.getElementById("observacoesInfo").textContent =
      ingresso.observacoes || "-"

    // Mostrar seção de resultado
    this.elementos.secaoFormulario.hidden = true
    this.elementos.secaoResultado.hidden = false
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

  mostrarLoading(mostrar) {
    this.elementos.modalLoading.hidden = !mostrar
  }

  // Navegação
  voltarAoPainel() {
    window.location.href = "../painel/index.html"
  }

  prepararNovoIngresso() {
    this.elementos.formEmissao.reset()
    this.elementos.secaoFormulario.hidden = false
    this.elementos.secaoResultado.hidden = true
  }

  imprimirIngresso() {
    window.print()
  }

  // Autenticação e Requisições
  verificarAutenticacao() {
    const token = sessionStorage.getItem("authToken")
    if (!token) return false
    this.token = token
    return true
  }

  async carregarDadosAdmin() {
    const dados = await this.realizarRequisicao("/admin/perfil")
    this.estado.dadosAdmin = dados
    return dados
  }

  async realizarRequisicao(endpoint, opcoes = {}) {
    const configPadrao = {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      ...opcoes,
    }

    try {
      const resposta = await fetch(`${CONFIG.API_URL}${endpoint}`, configPadrao)

      if (!resposta.ok) {
        if (resposta.status === 401) {
          this.voltarAoPainel()
          throw new Error("Sessão expirada")
        }
        throw new Error(`Erro HTTP: ${resposta.status}`)
      }

      return await resposta.json()
    } catch (erro) {
      this.tratarErro(erro)
      throw erro
    }
  }

  // Tratamento de Erros
  tratarErro(erro) {
    console.error("Erro:", erro)
    // Implementar sistema de notificação para o usuário
  }
}

// Inicialização segura
document.addEventListener("DOMContentLoaded", () => {
  window.emissor = new EmissorIngressos()
})
