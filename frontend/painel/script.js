// Configurações
const CONFIG = {
    API_URL: 'http://localhost:3000',
    ITENS_POR_PAGINA: 10,
    INTERVALO_ATUALIZACAO: 30000, // 30 segundos
    FORMATO_MOEDA: {
        style: 'currency',
        currency: 'BRL'
    }
};

// Classe principal do painel administrativo
class PainelAdmin {
    constructor() {
        // Cache de elementos DOM
        this.elementos = {
            nomeAdmin: document.getElementById('nomeAdmin'),
            totalIngressos: document.getElementById('totalIngressos'),
            receitaTotal: document.getElementById('receitaTotal'),
            receitaCaixa: document.getElementById('receitaCaixa'),
            corpoTabela: document.getElementById('corpoTabela'),
            paginaAtual: document.getElementById('paginaAtual'),
            totalPaginas: document.getElementById('totalPaginas'),
            paginaAnterior: document.getElementById('paginaAnterior'),
            proximaPagina: document.getElementById('proximaPagina'),
            botaoSair: document.getElementById('botaoSair'),
            botaoEmitir: document.getElementById('botaoEmitir'),
            botaoValidar: document.getElementById('botaoValidar'),
            modalLoading: document.getElementById('modalLoading')
        };

        // Estado da aplicação
        this.estado = {
            paginaAtual: 1,
            totalPaginas: 1,
            ingressos: [],
            dadosAdmin: null
        };

        this.inicializar();
    }

    async inicializar() {
        try {
            // Verificar autenticação
            if (!this.verificarAutenticacao()) {
                window.location.href = '../login/login.html';
                return;
            }

            // Inicializar eventos
            this.inicializarEventos();

            // Carregar dados iniciais
            await this.carregarDadosIniciais();

            // Iniciar atualização automática
            this.iniciarAtualizacaoAutomatica();
        } catch (erro) {
            this.tratarErro(erro);
        }
    }

    inicializarEventos() {
        // Eventos de paginação
        this.elementos.paginaAnterior.addEventListener('click', () => this.mudarPagina(this.estado.paginaAtual - 1));
        this.elementos.proximaPagina.addEventListener('click', () => this.mudarPagina(this.estado.paginaAtual + 1));

        // Eventos de botões
        this.elementos.botaoSair.addEventListener('click', () => this.realizarLogout());
        this.elementos.botaoEmitir.addEventListener('click', () => this.redirecionarEmissao());
        this.elementos.botaoValidar.addEventListener('click', () => this.redirecionarValidacao());

        // Evento para atualização manual
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.carregarDadosIniciais();
            }
        });
    }

    // Autenticação e Segurança
    verificarAutenticacao() {
        const token = sessionStorage.getItem('authToken');
        if (!token) return false;

        // Configurar token para requisições
        this.token = token;
        return true;
    }

    // Requisições HTTP
    async realizarRequisicao(endpoint, opcoes = {}) {
        const configPadrao = {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            },
            ...opcoes
        };

        try {
            const resposta = await fetch(`${CONFIG.API_URL}${endpoint}`, configPadrao);

            if (!resposta.ok) {
                if (resposta.status === 401) {
                    this.realizarLogout();
                    throw new Error('Sessão expirada');
                }
                throw new Error(`Erro HTTP: ${resposta.status}`);
            }

            return await resposta.json();
        } catch (erro) {
            this.tratarErro(erro);
            throw erro;
        }
    }

    // Carregamento de Dados
    async carregarDadosIniciais() {
        this.mostrarLoading(true);
        try {
            const [dadosAdmin, estatisticas, ingressos] = await Promise.all([
                this.carregarDadosAdmin(),
                this.carregarEstatisticas(),
                this.carregarIngressos(1)
            ]);

            this.atualizarInterface(dadosAdmin, estatisticas, ingressos);
        } finally {
            this.mostrarLoading(false);
        }
    }

    async carregarDadosAdmin() {
        const dados = await this.realizarRequisicao('/admin/perfil');
        this.estado.dadosAdmin = dados;
        return dados;
    }

    async carregarEstatisticas() {
        return await this.realizarRequisicao('/ingressos/estatisticas');
    }

    async carregarIngressos(pagina) {
        const ingressos = await this.realizarRequisicao(
            `/ingressos?pagina=${pagina}&limite=${CONFIG.ITENS_POR_PAGINA}`
        );
        this.estado.ingressos = ingressos.dados;
        this.estado.totalPaginas = Math.ceil(ingressos.total / CONFIG.ITENS_POR_PAGINA);
        return ingressos;
    }

    // Atualização da Interface
    atualizarInterface(dadosAdmin, estatisticas, ingressos) {
        // Atualizar dados do admin
        this.elementos.nomeAdmin.textContent = dadosAdmin.nome;

        // Atualizar estatísticas
        this.elementos.totalIngressos.textContent = estatisticas.total;
        this.elementos.receitaTotal.textContent = this.formatarMoeda(estatisticas.receitaTotal);
        this.elementos.receitaCaixa.textContent = this.formatarMoeda(estatisticas.receitaCaixa);

        // Atualizar tabela
        this.atualizarTabela();

        // Atualizar paginação
        this.atualizarPaginacao();
    }

    atualizarTabela() {
        this.elementos.corpoTabela.innerHTML = this.estado.ingressos
            .map(ingresso => this.criarLinhaIngresso(ingresso))
            .join('');
    }

    criarLinhaIngresso(ingresso) {
        return `
            <tr>
                <td>${ingresso.id.substring(0, 8)}...</td>
                <td><span class="status status-${ingresso.status}">${this.traduzirStatus(ingresso.status)}</span></td>
                <td>${ingresso.lote}</td>
                <td>${this.formatarMoeda(ingresso.preco)}</td>
                <td>${this.formatarData(ingresso.criado_em)}</td>
                <td>${ingresso.pagamento_status ? 'Pago' : 'Pendente'}</td>
                <td>${ingresso.comprador_original_nome}</td>
                <td>${this.formatarCPF(ingresso.comprador_original_cpf)}</td>
                <td>${ingresso.proprietario_atual_nome}</td>
                <td>${this.formatarCPF(ingresso.proprietario_atual_cpf)}</td>
                <td>${ingresso.vendedor_nome}</td>
                <td>
                    <button 
                        class="botao-acao" 
                        onclick="painelAdmin.visualizarIngresso('${ingresso.id}')"
                        aria-label="Visualizar detalhes do ingresso">
                        Visualizar
                    </button>
                </td>
            </tr>
        `;
    }

    // Utilitários
    formatarMoeda(valor) {
        return new Intl.NumberFormat('pt-BR', CONFIG.FORMATO_MOEDA).format(valor);
    }

    formatarData(data) {
        return new Intl.DateTimeFormat('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(new Date(data));
    }

    formatarCPF(cpf) {
        return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }

    traduzirStatus(status) {
        const traducoes = {
            'pending': 'Pendente',
            'paid': 'Pago',
            'used': 'Usado',
            'cancelled': 'Cancelado'
        };
        return traducoes[status] || status;
    }

    // Controle de Loading
    mostrarLoading(mostrar) {
        this.elementos.modalLoading.hidden = !mostrar;
    }

    // Tratamento de Erros
    tratarErro(erro) {
        console.error('Erro:', erro);
        // Implementar sistema de notificação para o usuário
    }

    // Navegação
    redirecionarEmissao() {
        window.location.href = 'emitir.html';
    }

    redirecionarValidacao() {
        window.location.href = 'validar.html';
    }

    // Logout
    realizarLogout() {
        sessionStorage.removeItem('authToken');
        window.location.href = '../login/login.html';
    }

    // Atualização Automática
    iniciarAtualizacaoAutomatica() {
        setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.carregarDadosIniciais();
            }
        }, CONFIG.INTERVALO_ATUALIZACAO);
    }
}

// Inicialização segura
document.addEventListener('DOMContentLoaded', () => {
    window.painelAdmin = new PainelAdmin();
});
