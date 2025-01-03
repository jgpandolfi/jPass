// Configurações e constantes
const CONFIG = {
    API_URL: 'https://api.jpass.com.br',
    TEMPO_MINIMO_CARREGAMENTO: 800,
    REGEX_EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    SENHA_MIN_CARACTERES: 8
};

// Classe principal de gerenciamento do login
class GerenciadorLogin {
    constructor() {
        // Elementos do DOM
        this.formLogin = document.getElementById('formLogin');
        this.inputEmail = document.getElementById('email');
        this.inputSenha = document.getElementById('senha');
        this.botaoEnviar = document.getElementById('botaoEnviar');
        this.botaoAlternarSenha = document.querySelector('.alternar-senha');
        this.containerAlerta = document.querySelector('.container-alerta');
        this.checkboxLembrar = document.getElementById('lembrar');

        // Estado do formulário
        this.estaEnviando = false;

        // Inicialização
        this.inicializar();
    }

    inicializar() {
        // Listeners de eventos
        this.formLogin.addEventListener('submit', (e) => this.manipularSubmissao(e));
        this.botaoAlternarSenha.addEventListener('click', () => this.alternarVisibilidadeSenha());
        this.inputEmail.addEventListener('input', () => this.validarEmail());
        this.inputSenha.addEventListener('input', () => this.validarSenha());

        // Recuperar dados salvos
        this.recuperarDadosSalvos();
    }

    // Validações
    validarEmail() {
        const email = this.inputEmail.value.trim();
        const elementoErro = document.getElementById('erro-email');

        if (!email) {
            this.mostrarErro(elementoErro, 'O e-mail é obrigatório');
            return false;
        }

        if (!CONFIG.REGEX_EMAIL.test(email)) {
            this.mostrarErro(elementoErro, 'Digite um e-mail válido');
            return false;
        }

        this.limparErro(elementoErro);
        return true;
    }

    validarSenha() {
        const senha = this.inputSenha.value;
        const elementoErro = document.getElementById('erro-senha');

        if (!senha) {
            this.mostrarErro(elementoErro, 'A senha é obrigatória');
            return false;
        }

        if (senha.length < CONFIG.SENHA_MIN_CARACTERES) {
            this.mostrarErro(elementoErro, `A senha deve ter no mínimo ${CONFIG.SENHA_MIN_CARACTERES} caracteres`);
            return false;
        }

        this.limparErro(elementoErro);
        return true;
    }

    // Manipulação do formulário
    async manipularSubmissao(evento) {
        evento.preventDefault();

        if (this.estaEnviando) return;

        if (!this.validarEmail() || !this.validarSenha()) {
            this.mostrarMensagem('Corrija os erros antes de continuar', 'erro');
            return;
        }

        await this.realizarLogin();
    }

    async realizarLogin() {
        this.iniciarCarregamento();

        const dadosLogin = {
            email: this.inputEmail.value.trim(),
            senha: this.inputSenha.value,
            manterConectado: this.checkboxLembrar.checked
        };

        try {
            const resposta = await this.enviarRequisicao('/auth/login', dadosLogin);

            if (resposta.sucesso) {
                this.salvarDadosLogin(dadosLogin);
                await this.redirecionarAposLogin(resposta.token);
            } else {
                throw new Error(resposta.mensagem || 'Erro ao realizar login');
            }
        } catch (erro) {
            this.tratarErroLogin(erro);
        } finally {
            this.finalizarCarregamento();
        }
    }

    // Requisições HTTP
    async enviarRequisicao(endpoint, dados) {
        const timestamp = Date.now();
        
        try {
            const resposta = await fetch(`${CONFIG.API_URL}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Request-Timestamp': timestamp.toString(),
                    'X-Client-Version': '1.0.0'
                },
                body: JSON.stringify({
                    ...dados,
                    timestamp
                })
            });

            if (!resposta.ok) {
                throw new Error(`Erro HTTP: ${resposta.status}`);
            }

            return await resposta.json();
        } catch (erro) {
            console.error('Erro na requisição:', erro);
            throw erro;
        }
    }

    // Utilitários
    mostrarMensagem(texto, tipo = 'info') {
        this.containerAlerta.textContent = texto;
        this.containerAlerta.className = `container-alerta alerta-${tipo}`;
    }

    mostrarErro(elemento, mensagem) {
        elemento.textContent = mensagem;
        elemento.style.display = 'block';
    }

    limparErro(elemento) {
        elemento.textContent = '';
        elemento.style.display = 'none';
    }

    alternarVisibilidadeSenha() {
        const tipo = this.inputSenha.type;
        this.inputSenha.type = tipo === 'password' ? 'text' : 'password';
        
        const icone = this.botaoAlternarSenha.querySelector('.icone-olho');
        icone.classList.toggle('visivel');
    }

    // Gerenciamento de estado
    iniciarCarregamento() {
        this.estaEnviando = true;
        this.botaoEnviar.setAttribute('data-loading', 'true');
        this.desabilitarFormulario();
    }

    finalizarCarregamento() {
        setTimeout(() => {
            this.estaEnviando = false;
            this.botaoEnviar.setAttribute('data-loading', 'false');
            this.habilitarFormulario();
        }, CONFIG.TEMPO_MINIMO_CARREGAMENTO);
    }

    desabilitarFormulario() {
        this.inputEmail.disabled = true;
        this.inputSenha.disabled = true;
        this.botaoEnviar.disabled = true;
    }

    habilitarFormulario() {
        this.inputEmail.disabled = false;
        this.inputSenha.disabled = false;
        this.botaoEnviar.disabled = false;
    }

    // Persistência
    salvarDadosLogin(dados) {
        if (dados.manterConectado) {
            localStorage.setItem('emailSalvo', dados.email);
        } else {
            localStorage.removeItem('emailSalvo');
        }
    }

    recuperarDadosSalvos() {
        const emailSalvo = localStorage.getItem('emailSalvo');
        if (emailSalvo) {
            this.inputEmail.value = emailSalvo;
            this.checkboxLembrar.checked = true;
        }
    }

    // Tratamento de erros
    tratarErroLogin(erro) {
        console.error('Erro no login:', erro);
        
        const mensagensErro = {
            'CredenciaisInvalidas': 'E-mail ou senha incorretos',
            'ContaBloqueada': 'Conta temporariamente bloqueada',
            'ErroServidor': 'Erro no servidor. Tente novamente mais tarde'
        };

        const mensagem = mensagensErro[erro.code] || 'Erro ao realizar login. Tente novamente';
        this.mostrarMensagem(mensagem, 'erro');
    }

    // Redirecionamento
    async redirecionarAposLogin(token) {
        // Salvar token de forma segura
        sessionStorage.setItem('authToken', token);
        
        // Redirecionar para a página principal
        window.location.href = '/dashboard/index.html';
    }
}

// Inicialização segura
document.addEventListener('DOMContentLoaded', () => {
    // Verificar se já está autenticado
    const token = sessionStorage.getItem('authToken');
    if (token) {
        window.location.href = '/dashboard/index.html';
        return;
    }

    // Inicializar gerenciador de login
    new GerenciadorLogin();
});

// Proteção contra ataques XSS
Object.freeze(CONFIG);
