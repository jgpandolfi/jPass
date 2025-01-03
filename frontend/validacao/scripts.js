// Configurações
const CONFIG = {
    API_URL: 'http://localhost:3000',
    SCANNER_CONFIG: {
        qrbox: {
            width: 250,
            height: 250
        },
        fps: 10
    },
    DELAY_RESULTADO: 2000,
    SOM_SUCESSO: new Audio('../assets/sounds/success.mp3'),
    SOM_ERRO: new Audio('../assets/sounds/error.mp3')
};

// Classe principal de validação
class ValidadorIngressos {
    constructor() {
        // Cache de elementos DOM
        this.elementos = {
            botaoVoltar: document.getElementById('botaoVoltar'),
            botaoQrCode: document.getElementById('botaoQrCode'),
            botaoId: document.getElementById('botaoId'),
            modalQrCode: document.getElementById('modalQrCode'),
            modalId: document.getElementById('modalId'),
            modalResultado: document.getElementById('modalResultado'),
            modalLoading: document.getElementById('modalLoading'),
            formValidacao: document.getElementById('formValidacao'),
            scannerVideo: document.getElementById('scannerVideo'),
            resultadoTitulo: document.getElementById('resultadoTitulo'),
            resultadoMensagem: document.getElementById('resultadoMensagem'),
            resultadoAcoes: document.getElementById('resultadoAcoes')
        };

        // Estado da aplicação
        this.estado = {
            scanner: null,
            scannerAtivo: false,
            validacaoEmProgresso: false
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

            // Pré-carregar sons
            CONFIG.SOM_SUCESSO.load();
            CONFIG.SOM_ERRO.load();

        } catch (erro) {
            this.tratarErro(erro);
        }
    }

    inicializarEventos() {
        // Botões principais
        this.elementos.botaoVoltar.addEventListener('click', () => this.voltarAoPainel());
        this.elementos.botaoQrCode.addEventListener('click', () => this.iniciarScannerQR());
        this.elementos.botaoId.addEventListener('click', () => this.abrirModalId());

        // Formulário de ID
        this.elementos.formValidacao.addEventListener('submit', (e) => this.validarPorId(e));

        // Eventos de fechamento de modais
        document.querySelectorAll('.botao-fechar').forEach(botao => {
            botao.addEventListener('click', () => this.fecharModais());
        });

        // Fechar modais ao pressionar ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.fecharModais();
        });
    }

    // Scanner QR Code
    async iniciarScannerQR() {
        try {
            if (!this.estado.scanner) {
                // Importar biblioteca HTML5QRCode dinamicamente
                const { Html5Qrcode } = await import('html5-qrcode');
                
                this.estado.scanner = new Html5Qrcode('scannerVideo');
            }

            this.elementos.modalQrCode.hidden = false;
            this.estado.scannerAtivo = true;

            await this.estado.scanner.start(
                { facingMode: 'environment' },
                CONFIG.SCANNER_CONFIG,
                this.processarQRCode.bind(this)
            );
        } catch (erro) {
            this.tratarErro(erro);
        }
    }

    async pararScanner() {
        if (this.estado.scanner && this.estado.scannerAtivo) {
            try {
                await this.estado.scanner.stop();
                this.estado.scannerAtivo = false;
            } catch (erro) {
                console.error('Erro ao parar scanner:', erro);
            }
        }
    }

    async processarQRCode(codigoQR) {
        if (this.estado.validacaoEmProgresso) return;
        
        await this.pararScanner();
        await this.validarIngresso(codigoQR);
    }

    // Validação de Ingressos
    async validarPorId(evento) {
        evento.preventDefault();
        if (this.estado.validacaoEmProgresso) return;

        const id = this.elementos.formValidacao.ingressoId.value.trim();
        if (!id) return;

        await this.validarIngresso(id);
    }

    async validarIngresso(identificador) {
        this.estado.validacaoEmProgresso = true;
        this.mostrarLoading(true);

        try {
            const resposta = await this.realizarRequisicao('/ingressos/validar', {
                method: 'POST',
                body: JSON.stringify({ identificador })
            });

            this.processarResultadoValidacao(resposta);
        } catch (erro) {
            this.tratarErro(erro);
        } finally {
            this.estado.validacaoEmProgresso = false;
            this.mostrarLoading(false);
        }
    }

    async confirmarValidacao(ingressoId) {
        this.mostrarLoading(true);

        try {
            const resposta = await this.realizarRequisicao('/ingressos/confirmar-validacao', {
                method: 'POST',
                body: JSON.stringify({ ingressoId })
            });

            if (resposta.sucesso) {
                this.mostrarResultadoFinal('sucesso');
            }
        } catch (erro) {
            this.tratarErro(erro);
        } finally {
            this.mostrarLoading(false);
        }
    }

    // Interface do Usuário
    processarResultadoValidacao(resultado) {
        this.fecharModais();
        
        const { modalResultado, resultadoTitulo, resultadoMensagem, resultadoAcoes } = this.elementos;

        // Configurar conteúdo do modal
        if (resultado.sucesso) {
            resultadoTitulo.textContent = 'Ingresso Válido';
            resultadoMensagem.textContent = `
                Lote: ${resultado.ingresso.lote}
                Proprietário: ${resultado.ingresso.proprietario_atual_nome}
                CPF: ${this.formatarCPF(resultado.ingresso.proprietario_atual_cpf)}
            `;

            resultadoAcoes.innerHTML = `
                <button class="botao-principal" onclick="validador.confirmarValidacao('${resultado.ingresso.id}')">
                    Validar Ingresso
                </button>
                <button class="botao-secundario" onclick="validador.fecharModais()">
                    Cancelar
                </button>
            `;

            CONFIG.SOM_SUCESSO.play();
        } else {
            resultadoTitulo.textContent = resultado.mensagem;
            resultadoMensagem.textContent = resultado.detalhes || '';
            resultadoAcoes.innerHTML = `
                <button class="botao-secundario" onclick="validador.fecharModais()">
                    Fechar
                </button>
            `;

            CONFIG.SOM_ERRO.play();
            document.body.style.backgroundColor = 'var(--cor-erro)';
        }

        modalResultado.hidden = false;
    }

    mostrarResultadoFinal(tipo) {
        const mensagens = {
            sucesso: {
                titulo: 'Boa festa!',
                mensagem: 'Ingresso validado com sucesso.',
                cor: 'var(--cor-sucesso)'
            },
            erro: {
                titulo: 'Erro na validação',
                mensagem: 'Não foi possível validar o ingresso.',
                cor: 'var(--cor-erro)'
            }
        };

        const config = mensagens[tipo];
        document.body.style.backgroundColor = config.cor;

        setTimeout(() => {
            document.body.style.backgroundColor = '';
            this.fecharModais();
        }, CONFIG.DELAY_RESULTADO);
    }

    // Utilitários
    formatarCPF(cpf) {
        return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }

    mostrarLoading(mostrar) {
        this.elementos.modalLoading.hidden = !mostrar;
    }

    fecharModais() {
        this.pararScanner();
        Object.values(this.elementos)
            .filter(el => el.classList?.contains('modal'))
            .forEach(modal => modal.hidden = true);
    }

    // Navegação
    voltarAoPainel() {
        window.location.href = '../painel/index.html';
    }

    // Autenticação e Requisições
    verificarAutenticacao() {
        const token = sessionStorage.getItem('authToken');
        if (!token) return false;
        this.token = token;
        return true;
    }

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
                    this.voltarAoPainel();
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

    // Tratamento de Erros
    tratarErro(erro) {
        console.error('Erro:', erro);
        this.mostrarResultadoFinal('erro');
    }
}

// Inicialização segura
document.addEventListener('DOMContentLoaded', () => {
    window.validador = new ValidadorIngressos();
});
