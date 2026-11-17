// Tratamento global de erros para depuração
window.onerror = function(msg, url, line) { 
    console.error("ERRO CRÍTICO: " + msg + "\nLinha: " + line); 
    return false; 
};

// HELPER: Normaliza códigos de parada para sempre terem 2 dígitos (ex: 1 -> "01", "2" -> "02")
function pad2(code) {
    if (code === null || code === undefined) return "";
    const str = String(code).trim();
    if (!str) return "";
    return str.length === 1 ? "0" + str : str;
}

// HELPER: Extrai APENAS NÚMEROS da máquina e padroniza com 2 dígitos (ex: "INJ-01", "inj 1" ou "1" -> "01")
function cleanMachineCode(input) {
    if (input === null || input === undefined) return "";
    const str = String(input).trim();
    const digitsOnly = str.replace(/\D/g, '');
    if (!digitsOnly) return str.toUpperCase();
    return pad2(digitsOnly);
}

// Variáveis Globais dos Gráficos (Chart.js)
let instChartBalanço = null;
let instChartIndices = null;
let instChartPareto = null;
let instChartMaquinas = null;

// Modo de filtro ativo no Dashboard ('mes_especifico', 'ontem', 'especifica')
let dashPeriodoAtual = 'mes_especifico';

// Configurações do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDGvPMQkaCMwyoYBbflvmvjqusy1szaqhs", 
    authDomain: "controleproducao-79f83.firebaseapp.com",
    projectId: "controleproducao-79f83",
    storageBucket: "controleproducao-79f83.firebasestorage.app",
    messagingSenderId: "824231079023",
    appId: "1:824231079023:web:ba1de46b7156e61d88719a"
};

// Inicialização do Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();
const colProducao = db.collection("producao");
const colUsuarios = db.collection("usuarios");
const colProdutos = db.collection("produtos");

// App secundário para cadastrar novos operadores sem deslogar o admin
const secondaryApp = firebase.apps.find(a => a.name === "SecondaryAuthApp") || firebase.initializeApp(firebaseConfig, "SecondaryAuthApp");
const secondaryAuth = secondaryApp.auth();

// Variáveis de Estado
let emailAdminMaster = null;
let activeUserRoleAdmin = false;
let cacheDataRecords = [];
let authenticatedUserRef = null;
let unscribeSnapshotProd = null;
let unscribeSnapshotUser = null;
let listaParadasLancadas = [];

// Motivos Padrão de Parada
const MOTIVOS_PARADAS_DATA = [
    { cod: "01", desc: "Set Up - Início de Produção" },
    { cod: "02", desc: "Set Up - Manutenção de Ferramental/Molde" },
    { cod: "03", desc: "Aguardando Empilhadeira / Talha" },
    { cod: "04", desc: "Limpeza de máquina" },
    { cod: "05", desc: "Reposição de Material" },
    { cod: "06", desc: "Ajuste de Parâmetros do Processo" },
    { cod: "07", desc: "Deslocamento" },
    { cod: "08", desc: "Falta de Energia" },
    { cod: "09", desc: "Aguardando Material" },
    { cod: "10", desc: "Inspeção de Liberação" },
    { cod: "11", desc: "Problemas de Qualidade - Produto" },
    { cod: "12", desc: "Problemas de Qualidade - Material" },
    { cod: "13", desc: "Ajuste de Ferramenta/Molde em Máquina" },
    { cod: "14", desc: "Ferramenta/molde em Manutenção" },
    { cod: "15", desc: "Espera de apoio da Ferramentaria" },
    { cod: "16", desc: "Ajuste de Periféricos da máquina" },
    { cod: "17", desc: "Manutenção Corretiva - Elétrica" },
    { cod: "18", desc: "Manutenção Corretiva - Mecânica" },
    { cod: "19", desc: "Try out" },
    { cod: "20", desc: "Falta de embalagem" },
    { cod: "21", desc: "Outros" }
];

// Lista Padrão de Injetoras
const LISTA_INJETORAS = [
    "01", "02", "03", "04", 
    "05", "06", "07", "08", 
    "09", "10", "11", "12"
];

// ==========================================
// INTEGRAÇÃO BANCO DE DADOS DE PRODUTOS
// ==========================================

async function buscarEPreencherProduto(codigoInput) {
    if (!codigoInput) return;

    const idProduto = codigoInput.trim().toUpperCase();

    try {
        const docSnap = await colProdutos.doc(idProduto).get();

        if (docSnap.exists) {
            const produto = docSnap.data();
            const elCavidades = document.getElementById('form-cav');
            const elCiclo = document.getElementById('form-ciclo');

            if (elCavidades && produto.cavidades !== undefined) elCavidades.value = produto.cavidades;
            if (elCiclo && produto.ciclo !== undefined) elCiclo.value = produto.ciclo;

            calculateEfficiencyPerformance();
        }
    } catch (erro) {
        console.error("Erro ao buscar produto no Firestore:", erro);
    }
}

async function registrarOuAtualizarProduto(codigo, cavidades, ciclo) {
    if (!codigo) return;

    const idProduto = codigo.trim().toUpperCase();

    try {
        await colProdutos.doc(idProduto).set({
            codigo: idProduto,
            cavidades: parseInt(cavidades, 10) || 0,
            ciclo: parseFloat(ciclo) || 0,
            ultimaAtualizacao: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (erro) {
        console.error("Erro ao registrar produto no Firestore:", erro);
    }
}

// ==========================================
// INICIALIZAÇÃO E MONITORAMENTO DE SESSÃO
// ==========================================
async function verifyInitialSetupSystem() {
    try {
        const configDoc = await db.collection("config").doc("sistema").get();
        if (configDoc.exists) {
            emailAdminMaster = configDoc.data().emailAdmin;
            document.getElementById('setup-screen').style.display = 'none';
            document.getElementById('auth-screen').style.display = 'flex';
            monitorAuthStateSession();
        } else {
            document.getElementById('setup-screen').style.display = 'flex';
            document.getElementById('auth-screen').style.display = 'none';
        }
    } catch (e) {
        document.getElementById('setup-screen').style.display = 'flex';
    }
}

const setupBtn = document.getElementById('btn-save-setup');
if (setupBtn) {
    setupBtn.onclick = async () => {
        const email = document.getElementById('setup-email').value.trim().toLowerCase();
        const pass = document.getElementById('setup-senha').value;
        if(!email.includes('@') || pass.length < 6) { alert("Insira dados válidos."); return; }
        try {
            await auth.createUserWithEmailAndPassword(email, pass);
            await db.collection("config").doc("sistema").set({ emailAdmin: email });
            emailAdminMaster = email;
            document.getElementById('setup-screen').style.display = 'none';
            monitorAuthStateSession();
        } catch (err) { alert(err.message); }
    };
}

function monitorAuthStateSession() {
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            authenticatedUserRef = user;
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'block';
            
            let checkAdmin = (user.email === emailAdminMaster);
            if (!checkAdmin) {
                try {
                    const snap = await colUsuarios.get();
                    snap.forEach(d => { if(d.data().email === user.email && d.data().role === 'adm') checkAdmin = true; });
                } catch (err) {}
            }
            activeUserRoleAdmin = checkAdmin;

            document.getElementById('user-display').innerHTML = `${activeUserRoleAdmin ? 'Administrador' : 'Operador'}:<br>${user.email}`;
            if(activeUserRoleAdmin) {
                if (document.getElementById('menu-adm-gate')) document.getElementById('menu-adm-gate').style.display = 'flex';
                if (document.getElementById('box-filter-user-adm')) document.getElementById('box-filter-user-adm').style.display = 'block';
                runUsersRealtimeListener();
            } else {
                if (document.getElementById('menu-adm-gate')) document.getElementById('menu-adm-gate').style.display = 'none';
                if (document.getElementById('box-filter-user-adm')) document.getElementById('box-filter-user-adm').style.display = 'none';
            }
            runProductionRealtimeListener();
        } else {
            document.getElementById('app-screen').style.display = 'none';
            document.getElementById('auth-screen').style.display = 'flex';
            if (unscribeSnapshotProd) unscribeSnapshotProd();
            if (unscribeSnapshotUser) unscribeSnapshotUser();
        }
    });
}

const loginBtn = document.getElementById('btn-login');
if (loginBtn) {
    loginBtn.onclick = () => {
        const email = document.getElementById('login-email').value.trim().toLowerCase();
        const pass = document.getElementById('login-senha').value;
        const errBox = document.getElementById('login-erro-banner');
        if(!email || !pass) { 
            if(errBox) { errBox.innerText = "Preencha tudo."; errBox.style.display="block"; }
            return; 
        }
        auth.signInWithEmailAndPassword(email, pass).catch(e => { 
            if(errBox) { errBox.innerText = "Credenciais inválidas."; errBox.style.display="block"; }
        });
    };
}

// NAVEGAÇÃO ENTRE ABAS
window.triggerSystemLogout = () => { auth.signOut(); window.switchViewTab('calc'); };

window.switchViewTab = (id) => {
    document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.sidebar-nav-item').forEach(b => b.classList.remove('active'));
    
    const targetView = document.getElementById(id);
    if(targetView) targetView.classList.add('active');
    
    const targetTab = document.getElementById(`tab-link-${id}`);
    if(targetTab) targetTab.classList.add('active');

    if(id === 'dash') {
        buildDashboardAnalyticsUI();
    }
};

// ==========================================
// CONTROLE DO FILTRO DE DATA/MÊS DO DASHBOARD
// ==========================================
window.toggleSeletorMes = function() {
    const boxMes = document.getElementById('box-seletor-mes');
    const btnMes = document.getElementById('btn-dash-mes');
    const btnOntem = document.getElementById('btn-dash-ontem');

    if (btnMes) btnMes.classList.add('active');
    if (btnOntem) btnOntem.classList.remove('active');

    if (boxMes) boxMes.style.display = 'inline-block';

    const selectData = document.getElementById('dash-select-data-lancada');
    if (selectData) selectData.value = '';

    setDashDatePeriod('mes_especifico');
};

window.setDashDatePeriod = function(tipo) {
    dashPeriodoAtual = tipo;

    const btnOntem = document.getElementById('btn-dash-ontem');
    const btnMes = document.getElementById('btn-dash-mes');
    const boxMes = document.getElementById('box-seletor-mes');
    const selectData = document.getElementById('dash-select-data-lancada');

    if (tipo === 'ontem') {
        if (btnOntem) btnOntem.classList.add('active');
        if (btnMes) btnMes.classList.remove('active');
        if (boxMes) boxMes.style.display = 'none';
        if (selectData) selectData.value = '';
    } else if (tipo === 'especifica') {
        if (btnOntem) btnOntem.classList.remove('active');
        if (btnMes) btnMes.classList.remove('active');
    }

    buildDashboardAnalyticsUI();
};

// ==========================================
// GERENCIAMENTO DE MOTIVOS DE PARADA
// ==========================================
function buildDowntimeCheckboxesUI() {
    const select = document.getElementById('select-motivo-parada');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Clique para escolher uma parada --</option>';
    MOTIVOS_PARADAS_DATA.forEach(m => {
        const opt = document.createElement('option');
        opt.value = pad2(m.cod);
        opt.textContent = `${pad2(m.cod)} - ${m.desc}`;
        select.appendChild(opt);
    });
    
    renderizarListaParadasAdicionadas();
}

window.aoSelecionarMotivoParada = function() {
    const select = document.getElementById('select-motivo-parada');
    const painel = document.getElementById('painel-adicionar-parada');
    const lbl = document.getElementById('lbl-motivo-selecionado');
    
    const cod = pad2(select.value);
    if (!cod) {
        if (painel) painel.style.display = 'none';
        return;
    }
    
    const motivoObj = MOTIVOS_PARADAS_DATA.find(m => pad2(m.cod) === cod);
    if (lbl && motivoObj) lbl.innerText = `Lançando: ${pad2(motivoObj.cod)} - ${motivoObj.desc}`;
    if (document.getElementById('temp-parada-ini')) document.getElementById('temp-parada-ini').value = "00:00";
    if (document.getElementById('temp-parada-fim')) document.getElementById('temp-parada-fim').value = "00:00";
    if (document.getElementById('temp-parada-desc')) document.getElementById('temp-parada-desc').value = "";
    if (painel) painel.style.display = 'block';
};

window.confirmarAdicaoParada = function() {
    const select = document.getElementById('select-motivo-parada');
    const cod = pad2(select.value);
    if (!cod) return;

    const motivoObj = MOTIVOS_PARADAS_DATA.find(m => pad2(m.cod) === cod);
    const ini = document.getElementById('temp-parada-ini').value;
    const fim = document.getElementById('temp-parada-fim').value;
    const desc = document.getElementById('temp-parada-desc').value.trim();

    const i = ini.split(':').map(Number);
    const f = fim.split(':').map(Number);
    let diff = (f[0] * 60 + f[1]) - (i[0] * 60 + i[1]);
    if (diff < 0) diff += 1440;

    listaParadasLancadas.push({
        cod: pad2(motivoObj ? motivoObj.cod : cod),
        desc: motivoObj ? motivoObj.desc : "Parada Não Identificada",
        ini: ini,
        fim: fim,
        totMin: diff,
        tot: `${diff} min`,
        ocorrencia: desc
    });

    select.value = "";
    const painel = document.getElementById('painel-adicionar-parada');
    if (painel) painel.style.display = 'none';

    renderizarListaParadasAdicionadas();
    sumAllDowntimes();
};

window.removerParada = function(index) {
    listaParadasLancadas.splice(index, 1);
    renderizarListaParadasAdicionadas();
    sumAllDowntimes();
};

function renderizarListaParadasAdicionadas() {
    const box = document.getElementById('wrapper-paradas-dinamicas');
    if (!box) return;
    box.innerHTML = "";

    listaParadasLancadas.forEach((p, idx) => {
        const codFormatted = pad2(p.cod);
        const row = document.createElement('div');
        row.style.marginBottom = "8px";
        row.style.padding = "10px";
        row.style.background = "#fff";
        row.style.border = "1px solid var(--border-gray)";
        row.style.borderRadius = "8px";
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";

        row.innerHTML = `
            <div>
                <b style="color:var(--text-dark); font-size:0.85rem;">${codFormatted} - ${p.desc}</b>
                <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">
                    ${p.ini} até ${p.fim} (<b>${p.tot}</b>)
                    ${p.ocorrencia ? `<br><i>Obs: ${p.ocorrencia}</i>` : ''}
                </div>
            </div>
            <button type="button" style="background:var(--danger); color:white; border:none; padding:6px 10px; border-radius:6px; font-weight:bold; cursor:pointer;" onclick="removerParada(${idx})">X</button>
        `;
        box.appendChild(row);
    });
}

function sumAllDowntimes() {
    let grandTotal = 0;
    listaParadasLancadas.forEach(p => {
        grandTotal += (p.totMin !== undefined ? p.totMin : parseInt(p.tot) || 0);
    });

    const h = String(Math.floor(grandTotal / 60)).padStart(2, '0');
    const min = String(grandTotal % 60).padStart(2, '0');

    const totalInput = document.getElementById('form-total-parada');
    if (totalInput) totalInput.value = `${h}:${min}`;

    const displayTotal = document.getElementById('display-total-parada');
    if (displayTotal) displayTotal.innerText = `${h}:${min}`;

    calculateEfficiencyPerformance();
}

// ==========================================
// CÁLCULO DE OEE E META
// ==========================================
function calculateEfficiencyPerformance() {
    const getVal = (id) => { const el = document.getElementById(id); return el && el.value ? el.value : ""; };
    const getNum = (id) => { const el = document.getElementById(id); return el && el.value ? parseFloat(el.value) || 0 : 0; };

    const strIni = getVal('form-ini');
    const strFim = getVal('form-fim');

    if (!strIni || !strFim) {
        if(document.getElementById('oee-pct')) document.getElementById('oee-pct').innerText = '0%';
        if(document.getElementById('oee-target')) document.getElementById('oee-target').innerText = 'meta=0';
        return;
    }

    const tIni = strIni.split(':').map(v => parseInt(v, 10) || 0);
    const tFim = strFim.split(':').map(v => parseInt(v, 10) || 0);
    const pTime = (getVal('form-total-parada') || "00:00").split(':').map(v => parseInt(v, 10) || 0);

    let totalTurno = (tFim[0] * 60 + tFim[1]) - (tIni[0] * 60 + tIni[1]);
    if (totalTurno < 0) totalTurno += 1440; 

    let totalParada = (pTime[0] * 60) + pTime[1];
    let prodTimeMinutos = totalTurno - totalParada;
    if (prodTimeMinutos < 0) prodTimeMinutos = 0;

    const ciclo = getNum('form-ciclo');
    const maxCav = getNum('form-cav');
    const real = getNum('form-real');

    let meta = 0;
    if (ciclo > 0 && maxCav > 0) {
        const pecasPorHora = Math.floor((3600 / ciclo) * maxCav);
        const horasTrabalhadas = prodTimeMinutos / 60;
        meta = Math.floor(pecasPorHora * horasTrabalhadas);
    }

    let oee = meta > 0 ? Math.round((real / meta) * 100) : 0;
    
    const oeePctEl = document.getElementById('oee-pct');
    const oeeTargetEl = document.getElementById('oee-target');
    if (oeePctEl) oeePctEl.innerText = `${oee}%`;
    if (oeeTargetEl) oeeTargetEl.innerText = `meta=${meta}`;

    const display = document.querySelector('.oee-box-display');
    if (display) {
        if (oee >= 85) display.style.background = "var(--success)";
        else if (oee >= 60) display.style.background = "var(--accent)";
        else display.style.background = "var(--danger)";
    }
}

['form-ini', 'form-fim', 'form-ciclo', 'form-cav', 'form-real', 'form-refugo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', calculateEfficiencyPerformance); el.addEventListener('change', calculateEfficiencyPerformance); }
});

// ==========================================
// PERSISTÊNCIA FIRESTORE (CRUD)
// ==========================================
const saveProdBtn = document.getElementById('btn-save-production');
if (saveProdBtn) {
    saveProdBtn.onclick = async () => {
        if(!authenticatedUserRef) return;
        const eid = document.getElementById('entry-edit-id').value;
        const data = document.getElementById('form-data').value;
        const rawMaq = document.getElementById('form-maq').value;
        const maq = cleanMachineCode(rawMaq);
        const prod = document.getElementById('form-prod').value.trim().toUpperCase();

        if(!data || !maq || !prod) { alert("Data, Máquina e Cód produto são obrigatórios!"); return; }

        const paradasTratadas = listaParadasLancadas.map(p => ({
            ...p,
            cod: pad2(p.cod)
        }));

        const cavVal = Number(document.getElementById('form-cav').value) || 0;
        const cicloVal = Number(document.getElementById('form-ciclo').value) || 0;

        const packet = {
            data, 
            nomeOperador: document.getElementById('form-nome').value.trim(),
            maquina: maq, 
            produto: prod,
            nrOp: document.getElementById('form-op').value.trim(),
            qtdRefugo: Number(document.getElementById('form-refugo').value) || 0,
            qtdRefugoSetup: Number(document.getElementById('form-refugo-setup').value) || 0,
            inicioTurno: document.getElementById('form-ini').value,
            fimTurno: document.getElementById('form-fim').value,
            ciclo: cicloVal,
            cavidades: cavVal,
            qtdReal: Number(document.getElementById('form-real').value),
            totalParado: document.getElementById('form-total-parada').value,
            obs: document.getElementById('form-obs').value,
            efetividade: document.getElementById('oee-pct').innerText,
            paradasMapeadas: paradasTratadas
        };

        try {
            if(eid) {
                await colProducao.doc(eid).update(packet);
                alert("Atualizado com sucesso!");
            } else {
                packet.criadoPor = authenticatedUserRef.email;
                await colProducao.add(packet);
                alert("Salvo com sucesso!");
            }

            if (prod && cavVal > 0 && cicloVal > 0) {
                await registrarOuAtualizarProduto(prod, cavVal, cicloVal);
            }

            resetInputsFormLancamento();
        } catch (err) { alert(err.message); }
    };
}

function resetInputsFormLancamento() {
    if(document.getElementById('entry-edit-id')) document.getElementById('entry-edit-id').value = "";
    if(document.getElementById('form-nome')) document.getElementById('form-nome').value = "";
    if(document.getElementById('form-maq')) document.getElementById('form-maq').value = "";
    if(document.getElementById('form-prod')) document.getElementById('form-prod').value = "";
    if(document.getElementById('form-op')) document.getElementById('form-op').value = "";
    if(document.getElementById('form-refugo')) document.getElementById('form-refugo').value = "0";
    if(document.getElementById('form-refugo-setup')) document.getElementById('form-refugo-setup').value = "0";
    if(document.getElementById('form-obs')) document.getElementById('form-obs').value = "";
    if(document.getElementById('form-real')) document.getElementById('form-real').value = "";
    if(document.getElementById('form-ciclo')) document.getElementById('form-ciclo').value = "";
    if(document.getElementById('form-cav')) document.getElementById('form-cav').value = "";
    if(document.getElementById('form-total-parada')) document.getElementById('form-total-parada').value = "00:00";
    if(document.getElementById('display-total-parada')) document.getElementById('display-total-parada').innerText = "00:00";

    listaParadasLancadas = [];

    if(document.getElementById('btn-cancel-edit')) document.getElementById('btn-cancel-edit').style.display = 'none';
    if(document.getElementById('btn-delete-entry')) document.getElementById('btn-delete-entry').style.display = 'none';
    if(document.getElementById('btn-save-production')) document.getElementById('btn-save-production').innerText = "SALVAR REGISTRO";
    
    buildDowntimeCheckboxesUI();
    setTodayOnDateField();
    calculateEfficiencyPerformance();
}

const cancelEditBtn = document.getElementById('btn-cancel-edit');
if (cancelEditBtn) cancelEditBtn.onclick = resetInputsFormLancamento;

const deleteEntryBtn = document.getElementById('btn-delete-entry');
if (deleteEntryBtn) {
    deleteEntryBtn.onclick = async () => {
        const id = document.getElementById('entry-edit-id').value;
        if(id && confirm("Excluir definitivamente?")) {
            await colProducao.doc(id).delete();
            resetInputsFormLancamento();
        }
    };
}

function updateLaunchDateFilterOptions() {
    const selectEl = document.getElementById('filter-launch-date');
    if (!selectEl) return;
    
    const previousSelection = selectEl.value;
    const allowedRecords = cacheDataRecords.filter(i => activeUserRoleAdmin || i.criadoPor === authenticatedUserRef.email);
    const uniqueDates = [...new Set(allowedRecords.map(i => i.data).filter(d => !!d))].sort((a, b) => b.localeCompare(a));
    
    selectEl.innerHTML = '<option value="">Todas as datas lançadas</option>';
    uniqueDates.forEach(date => {
        const option = document.createElement('option');
        option.value = date; 
        option.textContent = date.split('-').reverse().join('/');
        selectEl.appendChild(option);
    });
    if (uniqueDates.includes(previousSelection)) selectEl.value = previousSelection;
}

function runProductionRealtimeListener() {
    unscribeSnapshotProd = colProducao.onSnapshot((snap) => {
        cacheDataRecords = [];
        snap.forEach(d => cacheDataRecords.push({ id: d.id, ...d.data() }));
        cacheDataRecords.sort((a, b) => cleanMachineCode(a.maquina).localeCompare(cleanMachineCode(b.maquina), undefined, { numeric: true }));
        updateLaunchDateFilterOptions();
        applyFilterAndFillTable();
        const dashTab = document.getElementById('dash');
        if(dashTab && dashTab.classList.contains('active')) buildDashboardAnalyticsUI();
    });
}

// ==========================================
// FILTROS E TABELA DE RELATÓRIO
// ==========================================
function applyFilterAndFillTable() {
    const fLaunchDate = document.getElementById('filter-launch-date') ? document.getElementById('filter-launch-date').value : "";
    const fStart = document.getElementById('filter-start-date') ? document.getElementById('filter-start-date').value : "";
    const fEnd = document.getElementById('filter-end-date') ? document.getElementById('filter-end-date').value : "";
    const fMaq = document.getElementById('filter-maq') ? cleanMachineCode(document.getElementById('filter-maq').value) : "";
    const fProd = document.getElementById('filter-prod') ? document.getElementById('filter-prod').value.trim().toLowerCase() : "";
    const fUser = document.getElementById('filter-user') ? document.getElementById('filter-user').value.trim().toLowerCase() : "";

    let res = cacheDataRecords.filter(i => {
        if(!activeUserRoleAdmin && i.criadoPor !== authenticatedUserRef.email) return false;
        if(fLaunchDate) { if(i.data !== fLaunchDate) return false; } 
        else {
            if(fStart && i.data < fStart) return false;
            if(fEnd && i.data > fEnd) return false;
        }
        if(fMaq && !cleanMachineCode(i.maquina).includes(fMaq)) return false;
        if(fProd && !i.produto.toLowerCase().includes(fProd)) return false;
        if(fUser && activeUserRoleAdmin && !i.criadoPor.toLowerCase().includes(fUser)) return false;
        return true;
    });

    const body = document.getElementById('table-entries-body');
    if (!body) return;
    body.innerHTML = "";

    if(res.length === 0) {
        body.innerHTML = `<tr><td colspan="18" style="text-align:center; color:#64748b; padding:20px;">Nenhum registro encontrado</td></tr>`;
        return;
    }

    res.forEach(i => {
        const tr = document.createElement('tr');
        
        let det = i.paradasMapeadas?.map(p => {
            const codForm = pad2(p.cod);
            return `• ${codForm} - ${p.desc || ''} (${p.tot || p.totMin + ' min'})${p.ocorrencia ? ` - ${p.ocorrencia}` : ''}`;
        }).join('<br>') || 'Nenhuma';

        const maqFormatada = cleanMachineCode(i.maquina);

        tr.innerHTML = `
            <td><b>${i.data.split('-').reverse().slice(0,2).join('/')}</b></td>
            <td>${i.nomeOperador || '-'}</td>
            <td><b>${maqFormatada}</b></td>
            <td>${i.produto}</td>
            <td>${i.nrOp || '-'}</td>
            <td>${i.inicioTurno}</td><td>${i.fimTurno}</td><td>${i.qtdReal}</td><td>${i.qtdRefugo || 0}</td><td>${i.qtdRefugoSetup || 0}</td>
            <td>${i.cavidades || 0}</td><td>${i.ciclo || 0}</td>
            <td><b style="color:${Number(i.efetividade ? i.efetividade.replace('%','') : 0)>=85?'var(--success)':'var(--accent)'}">${i.efetividade || '0%'}</b></td>
            <td>${i.totalParado || '00:00'}</td>
            <td style="font-size:0.75rem; color:#475569; min-width:180px;">${det}</td>
            <td style="font-size:0.75rem;">${i.obs || '-'}</td>
            <td style="font-size:0.75rem; color:#64748b;">${i.criadoPor || '-'}</td>
            <td><button class="btn-submit-system" style="padding:6px 10px; font-size:0.75rem;" id="edt-${i.id}">EDITAR</button></td>
        `;
        tr.querySelector(`#edt-${i.id}`).onclick = () => loadRecordToEdit(i);
        body.appendChild(tr);
    });
}

function loadRecordToEdit(i) {
    window.switchViewTab('calc');
    document.getElementById('entry-edit-id').value = i.id;
    document.getElementById('form-data').value = i.data;
    document.getElementById('form-nome').value = i.nomeOperador || "";
    document.getElementById('form-ini').value = i.inicioTurno;
    document.getElementById('form-fim').value = i.fimTurno;
    document.getElementById('form-maq').value = cleanMachineCode(i.maquina);
    document.getElementById('form-prod').value = i.produto;
    document.getElementById('form-op').value = i.nrOp || "";
    document.getElementById('form-refugo').value = i.qtdRefugo || "0";
    document.getElementById('form-refugo-setup').value = i.qtdRefugoSetup || "0";
    document.getElementById('form-ciclo').value = i.ciclo;
    document.getElementById('form-cav').value = i.cavidades;
    document.getElementById('form-real').value = i.qtdReal;
    document.getElementById('form-obs').value = i.obs || "";

    buildDowntimeCheckboxesUI();
    
    listaParadasLancadas = (i.paradasMapeadas || []).map(p => ({
        ...p,
        cod: pad2(p.cod)
    }));

    renderizarListaParadasAdicionadas();
    
    document.getElementById('form-total-parada').value = i.totalParado || "00:00";
    if(document.getElementById('display-total-parada')) document.getElementById('display-total-parada').innerText = i.totalParado || "00:00";
    
    document.getElementById('btn-cancel-edit').style.display = 'block';
    document.getElementById('btn-delete-entry').style.display = 'block';
    document.getElementById('btn-save-production').innerText = "ALTERAR REGISTRO";
    calculateEfficiencyPerformance();
}

['filter-launch-date', 'filter-start-date', 'filter-end-date', 'filter-maq', 'filter-prod', 'filter-user'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { 
        el.oninput = () => { applyFilterAndFillTable(); if(document.getElementById('dash').classList.contains('active')) buildDashboardAnalyticsUI(); }; 
        el.onchange = applyFilterAndFillTable; 
    }
});

const csvBtn = document.getElementById('btn-trigger-csv-export');
if (csvBtn) {
    csvBtn.onclick = () => {
        let res = cacheDataRecords;
        if (res.length === 0) { alert("Nenhum registro para exportar!"); return; }
        let csv = "Data;Nome Operador;Maquina;Produto;OP;Refugo;Refugo Setup;Inicio;Fim;Cavidades;Ciclo;Total Paradas;Real;Efetividade;Criador\n";
        res.forEach(i => { csv += `${i.data};${i.nomeOperador || ''};${cleanMachineCode(i.maquina)};${i.produto};${i.nrOp || ''};${i.qtdRefugo || 0};${i.qtdRefugoSetup || 0};${i.inicioTurno};${i.fimTurno};${i.cavidades};${i.ciclo};${i.totalParado};${i.qtdReal};${i.efetividade};${i.criadoPor}\n`; });
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `PROD_TECH_Export.csv`;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };
}

// ==========================================
// PAINEL ADMINISTRATIVO DE USUÁRIOS
// ==========================================
function runUsersRealtimeListener() {
    unscribeSnapshotUser = colUsuarios.onSnapshot((snap) => {
        const tbody = document.getElementById('table-users-body');
        if (!tbody) return;
        tbody.innerHTML = "";
        snap.forEach(d => {
            const u = { id: d.id, ...d.data() };
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${u.email}</td><td><code>${u.senha}</code></td><td>${u.role}</td><td><button style="background:var(--danger); border:none; color:white; padding:4px 8px; border-radius:4px; cursor:pointer;" id="d-usr-${u.id}">X</button></td>`;
            tr.querySelector(`#d-usr-${u.id}`).onclick = async () => { if(confirm("Excluir conta?")) await colUsuarios.doc(u.id).delete(); };
            tbody.appendChild(tr);
        });
    });
}

const createOpBtn = document.getElementById('btn-create-operator');
if (createOpBtn) {
    createOpBtn.onclick = async () => {
        const email = document.getElementById('adm-new-user-email').value.trim().toLowerCase();
        if(!email) { alert("Insira um e-mail válido!"); return; }
        try {
            await secondaryAuth.createUserWithEmailAndPassword(email, "123456");
            await secondaryAuth.signOut();
            await colUsuarios.add({ email, senha: "123456", role: "operador" });
            alert("Operador cadastrado com sucesso!");
            document.getElementById('adm-new-user-email').value = "";
        } catch (e) { alert("Erro ao registrar: " + e.message); }
    };
}

function setTodayOnDateField() {
    const dateEl = document.getElementById('form-data');
    if (dateEl) {
        const hoje = new Date();
        const tzOffset = hoje.getTimezoneOffset() * 60000;
        dateEl.value = new Date(hoje.getTime() - tzOffset).toISOString().slice(0, 10);
    }
}

// ==========================================
// CONSTRUÇÃO DO DASHBOARD OEE E GRÁFICOS
// ==========================================
function buildDashboardAnalyticsUI() {
    const fLaunchDate = document.getElementById('filter-launch-date') ? document.getElementById('filter-launch-date').value : "";
    const fStart = document.getElementById('filter-start-date') ? document.getElementById('filter-start-date').value : "";
    const fEnd = document.getElementById('filter-end-date') ? document.getElementById('filter-end-date').value : "";
    const fMaqGeral = document.getElementById('filter-maq') ? cleanMachineCode(document.getElementById('filter-maq').value) : "";
    const fProd = document.getElementById('filter-prod') ? document.getElementById('filter-prod').value.trim().toLowerCase() : "";
    const fUser = document.getElementById('filter-user') ? document.getElementById('filter-user').value.trim().toLowerCase() : "";

    const dashMaqSelect = document.getElementById('dash-select-maquina');
    const maqSelecionadaDash = dashMaqSelect ? cleanMachineCode(dashMaqSelect.value) : "";

    let dadosFiltrados = cacheDataRecords.filter(i => {
        if(!activeUserRoleAdmin && i.criadoPor !== authenticatedUserRef.email) return false;

        if (dashPeriodoAtual === 'ontem') {
            const dataOntem = new Date();
            dataOntem.setDate(dataOntem.getDate() - 1);
            const tzOffset = dataOntem.getTimezoneOffset() * 60000;
            const dataOntemStr = new Date(dataOntem.getTime() - tzOffset).toISOString().slice(0, 10);
            if (i.data !== dataOntemStr) return false;
        } 
        else if (dashPeriodoAtual === 'mes_especifico') {
            const selectMes = document.getElementById('dash-select-mes');
            if (selectMes && selectMes.value) {
                const mesSel = parseInt(selectMes.value, 10);
                if (!i.data) return false;
                const partes = i.data.split('-');
                const mesItem = parseInt(partes[1], 10);
                if (mesItem !== mesSel) return false;
            }
        } 
        else if (dashPeriodoAtual === 'especifica') {
            const selectDataEspecifica = document.getElementById('dash-select-data-lancada');
            if (selectDataEspecifica && selectDataEspecifica.value) {
                if (i.data !== selectDataEspecifica.value) return false;
            }
        }

        if(fLaunchDate) { if(i.data !== fLaunchDate) return false; } 
        else {
            if(fStart && i.data < fStart) return false;
            if(fEnd && i.data > fEnd) return false;
        }
        if(fMaqGeral && !cleanMachineCode(i.maquina).includes(fMaqGeral)) return false;
        if(fProd && !i.produto.toLowerCase().includes(fProd)) return false;
        if(fUser && activeUserRoleAdmin && !i.criadoPor.toLowerCase().includes(fUser)) return false;
        return true;
    });

    atualizarSelectDatasLancadasDash(cacheDataRecords);

    // Gráfico de Peças Produzidas por Injetora (01 a 12)
    let prodPorInjetora = Array(12).fill(0);
    dadosFiltrados.forEach(i => {
        let cleanCode = cleanMachineCode(i.maquina);
        let index = LISTA_INJETORAS.indexOf(cleanCode);
        if (index !== -1) {
            prodPorInjetora[index] += (Number(i.qtdReal) || 0);
        }
    });

    if (instChartMaquinas) instChartMaquinas.destroy();
    const ctxMaquinasEl = document.getElementById('chartMaquinasInjetoras');
    if (ctxMaquinasEl) {
        instChartMaquinas = new Chart(ctxMaquinasEl.getContext('2d'), {
            type: 'bar',
            data: {
                labels: LISTA_INJETORAS,
                datasets: [{
                    label: 'Total Peças Produzidas',
                    data: prodPorInjetora,
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    // Filtragem específica para Injetora selecionada no Dashboard
    let dadosParaParadasEOperador = dadosFiltrados;
    if (maqSelecionadaDash) {
        dadosParaParadasEOperador = dadosFiltrados.filter(i => cleanMachineCode(i.maquina) === maqSelecionadaDash);
    }

    const lblPareto = document.getElementById('lbl-pareto-titulo');
    if (lblPareto) {
        lblPareto.innerText = maqSelecionadaDash 
            ? `Pareto de Paradas (Minutos) - Máquina ${maqSelecionadaDash}` 
            : `Pareto de Paradas (Minutos) - Todas as Máquinas`;
    }

    let totalMinutosParados = 0;
    let totalHorasTrabalhadas = 0;
    let somaOEE = 0;
    let contRegistrosOEE = 0;
    let mapaParadas = {};

    dadosFiltrados.forEach(i => {
        if(i.totalParado) {
            const parts = i.totalParado.split(':').map(Number);
            totalMinutosParados += (parts[0] * 60) + (parts[1] || 0);
        }
        if(i.inicioTurno && i.fimTurno) {
            const stringsIni = i.inicioTurno.split(':').map(Number);
            const stringsFim = i.fimTurno.split(':').map(Number);
            let dMin = (stringsFim[0] * 60 + stringsFim[1]) - (stringsIni[0] * 60 + stringsIni[1]);
            if(dMin < 0) dMin += 1440;
            totalHorasTrabalhadas += (dMin / 60);
        }
        if(i.efetividade) {
            let valorNum = parseFloat(i.efetividade.replace('%', ''));
            if(!isNaN(valorNum)) { somaOEE += valorNum; contRegistrosOEE++; }
        }
    });

    dadosParaParadasEOperador.forEach(i => {
        if(i.paradasMapeadas && Array.isArray(i.paradasMapeadas)) {
            i.paradasMapeadas.forEach(p => {
                let mMin = 0;
                if (p.totMin !== undefined) {
                    mMin = parseInt(p.totMin) || 0;
                } else if (p.tot) {
                    mMin = parseInt(p.tot.replace(' min', '')) || 0;
                }
                
                const codPadronizado = pad2(p.cod);
                const motivoObj = MOTIVOS_PARADAS_DATA.find(m => pad2(m.cod) === codPadronizado);
                const descFinal = p.desc || (motivoObj ? motivoObj.desc : `Parada ${codPadronizado}`);
                
                let identificador = `${codPadronizado} - ${descFinal}`;
                mapaParadas[identificador] = (mapaParadas[identificador] || 0) + mMin;
            });
        }
    });

    const hParadas = Math.floor(totalMinutosParados / 60);
    const mParadas = totalMinutosParados % 60;
    if(document.getElementById('dash-card-parado')) document.getElementById('dash-card-parado').innerText = `${hParadas}h ${mParadas}m`;
    if(document.getElementById('dash-card-utilizado')) document.getElementById('dash-card-utilizado').innerText = `${Math.round(totalHorasTrabalhadas)} hrs`;
    
    let oeeGlobalFinal = contRegistrosOEE > 0 ? Math.round(somaOEE / contRegistrosOEE) : 0;
    if(document.getElementById('dash-card-oee')) document.getElementById('dash-card-oee').innerText = `${oeeGlobalFinal}%`;

    let horasDisponiveisMes = 7248;
    let pctAproveitamento = horasDisponiveisMes > 0 ? Math.round((totalHorasTrabalhadas / horasDisponiveisMes) * 100) : 0;
    if(document.getElementById('dash-txt-aproveitamento')) document.getElementById('dash-txt-aproveitamento').innerText = `${pctAproveitamento}%`;

    if(instChartBalanço) instChartBalanço.destroy();
    if(instChartIndices) instChartIndices.destroy();
    if(instChartPareto) instChartPareto.destroy();

    const ctxBalançoEl = document.getElementById('chartBalançoCarga');
    if (ctxBalançoEl) {
        instChartBalanço = new Chart(ctxBalançoEl.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Horas do Mês'],
                datasets: [
                    { label: 'Disponíveis (Meta)', data: [horasDisponiveisMes], backgroundColor: '#e2e8f0', barThickness: 24 },
                    { label: 'Utilizadas (Apontadas)', data: [Math.round(totalHorasTrabalhadas)], backgroundColor: '#4f46e5', barThickness: 24 }
                ]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { max: 8000 } } }
        });
    }

    let dispCalculada = oeeGlobalFinal > 0 ? Math.min(100, oeeGlobalFinal + 5) : 0;
    let perfCalculada = oeeGlobalFinal > 0 ? Math.min(100, oeeGlobalFinal + 2) : 0;
    let qualCalculada = oeeGlobalFinal > 0 ? 98 : 0;

    const ctxIndicesEl = document.getElementById('chartIndicesOEE');
    if (ctxIndicesEl) {
        instChartIndices = new Chart(ctxIndicesEl.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Disponibilidade', 'Performance', 'Qualidade', 'OEE Global'],
                datasets: [{ label: 'Percentual (%)', data: [dispCalculada, perfCalculada, qualCalculada, oeeGlobalFinal], backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#6366f1'] }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { max: 100, beginAtZero: true } } }
        });
    }

    let paradasOrdenadas = Object.keys(mapaParadas).map(k => ({ label: k, total: mapaParadas[k] })).sort((a,b) => b.total - a.total);

    const ctxParetoEl = document.getElementById('chartParetoParadas');
    if (ctxParetoEl) {
        instChartPareto = new Chart(ctxParetoEl.getContext('2d'), {
            type: 'bar',
            data: {
                labels: paradasOrdenadas.map(p => p.label),
                datasets: [{ label: 'Minutos', data: paradasOrdenadas.map(p => p.total), backgroundColor: '#ef4444' }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
    }

    const boxOperadores = document.getElementById('dash-info-operadores');
    if (boxOperadores) {
        if (!maqSelecionadaDash) {
            boxOperadores.innerHTML = `
                <div style="padding:10px; background:#f8fafc; border-radius:8px; border:1px dashed #cbd5e1; text-align:center;">
                    <span style="color:#64748b; font-size:0.85rem; font-style:italic;">Selecione uma máquina no menu ao lado para detalhar o operador e as paradas efetuadas.</span>
                </div>
            `;
        } else {
            let listaDetalhadaHTML = [];

            dadosParaParadasEOperador.forEach(rec => {
                let opNome = rec.nomeOperador || rec.criadoPor || "Operador Não Identificado";
                
                if (rec.paradasMapeadas && Array.isArray(rec.paradasMapeadas) && rec.paradasMapeadas.length > 0) {
                    rec.paradasMapeadas.forEach(p => {
                        let codForm = pad2(p.cod);
                        let motivoObj = MOTIVOS_PARADAS_DATA.find(m => pad2(m.cod) === codForm);
                        let descMotivo = p.desc || (motivoObj ? motivoObj.desc : "Sem descrição");
                        let tempoTexto = p.tot || (p.totMin ? `${p.totMin} min` : "");

                        listaDetalhadaHTML.push(`
                            <div style="padding: 8px 12px; margin-bottom: 6px; background: #ffffff; border-left: 4px solid #ef4444; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); font-size: 0.85rem;">
                                <span style="color: #1e293b; font-weight: bold;">${opNome}</span> - 
                                <span style="color: #2563eb; font-weight: bold;">${codForm}</span> - 
                                <span style="color: #334155;">${descMotivo}</span> 
                                ${tempoTexto ? `<span style="color: #64748b; font-size: 0.78rem;">(${tempoTexto})</span>` : ''}
                                ${p.ocorrencia ? `<div style="color:#64748b; font-size:0.75rem; font-style:italic; margin-top:2px;">Obs: ${p.ocorrencia}</div>` : ''}
                            </div>
                        `);
                    });
                }
            });

            if (listaDetalhadaHTML.length > 0) {
                boxOperadores.innerHTML = `
                    <div>
                        <b style="font-size:0.85rem; color:#1e293b; display:block; margin-bottom:8px;">Detalhamento da Máquina ${maqSelecionadaDash}:</b>
                        ${listaDetalhadaHTML.join('')}
                    </div>
                `;
            } else {
                boxOperadores.innerHTML = `
                    <div style="padding:10px; background:#f0fdf4; border-radius:8px; border:1px solid #bbf7d0; text-align:center;">
                        <span style="color:#166534; font-weight:bold; font-size:0.85rem;">Nenhuma parada registrada para a máquina ${maqSelecionadaDash} no período.</span>
                    </div>
                `;
            }
        }
    }
}

function atualizarSelectDatasLancadasDash(registros) {
    const selectData = document.getElementById('dash-select-data-lancada');
    if (!selectData) return;

    const valorAnterior = selectData.value;
    const datasUnicas = [...new Set(registros.map(r => r.data))].filter(Boolean).sort().reverse();

    selectData.innerHTML = '<option value="">-- Selecionar uma data lançada --</option>';
    datasUnicas.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        const [ano, mes, dia] = d.split('-');
        opt.textContent = `${dia}/${mes}/${ano}`;
        selectData.appendChild(opt);
    });

    selectData.value = valorAnterior;
}

// Inicialização Global na carga do DOM
window.addEventListener('DOMContentLoaded', () => {
    verifyInitialSetupSystem();
    setTodayOnDateField();
    buildDowntimeCheckboxesUI();

    const inputProduto = document.getElementById('form-prod');
    if (inputProduto) {
        inputProduto.addEventListener('change', (e) => {
            buscarEPreencherProduto(e.target.value);
        });
        inputProduto.addEventListener('blur', (e) => {
            buscarEPreencherProduto(e.target.value);
        });
    }

    const selectMes = document.getElementById('dash-select-mes');
    if (selectMes) {
        const mesAtual = new Date().getMonth() + 1;
        selectMes.value = String(mesAtual);
    }
});
