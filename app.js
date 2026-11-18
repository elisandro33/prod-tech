// ========================================================
// COLE AQUI A URL DO SEU WEB APP DO GOOGLE APPS SCRIPT:
// ========================================================
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxKmHvNqLji-71kJcOZdlGs31yWwbD3PlIrtP5GTcFgp4SkNbjYfFxAPPjkZ6ZhfVw8yw/exec";

window.onerror = function(msg, url, line) { 
    console.error("ERRO CRÍTICO: " + msg + "\nLinha: " + line); 
    return false; 
};

function pad2(code) {
    if (code === null || code === undefined) return "";
    const str = String(code).trim();
    if (!str) return "";
    return str.length === 1 ? "0" + str : str;
}

function cleanMachineCode(input) {
    if (input === null || input === undefined) return "";
    const str = String(input).trim();
    const digitsOnly = str.replace(/\D/g, '');
    if (!digitsOnly) return str.toUpperCase();
    return pad2(digitsOnly);
}

function formatPtNumber(val, decimals = 1) {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function formatSheetTime(val) {
    if (!val) return "00:00";
    const str = String(val).trim();
    if (str.includes("T")) {
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
            const hh = String(d.getUTCHours()).padStart(2, '0');
            const mm = String(d.getUTCMinutes()).padStart(2, '0');
            return `${hh}:${mm}`;
        }
    }
    const match = str.match(/(\d{1,2}):(\d{2})/);
    if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
    return "00:00";
}

function formatSheetDate(val) {
    if (!val) return "";
    const str = String(val).trim();
    if (str.includes("T")) return str.split("T")[0];
    if (str.includes("/")) {
        const p = str.split("/");
        if (p.length === 3) return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
    }
    return str;
}

function formatSheetOEE(val) {
    if (val === null || val === undefined || val === "") return "0%";
    const str = String(val).trim();
    if (str.includes("%")) return str;
    const num = parseFloat(str.replace(",", "."));
    if (!isNaN(num)) {
        return num <= 1.5 && num > 0 ? `${Math.round(num * 100)}%` : `${Math.round(num)}%`;
    }
    return "0%";
}

let instChartBalanço = null;
let instChartIndices = null;
let instChartPareto = null;
let instChartMaquinas = null;
let dashPeriodoAtual = 'mes_especifico';

let activeUserRoleAdmin = false;
let authenticatedUserRef = null;
let cacheDataRecords = [];
let cacheProdutosList = [];
let cacheProgramacaoList = [];
let cacheUsuariosList = [];
let listaParadasLancadas = [];

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

const LISTA_INJETORAS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13"];

// ==========================================
// COMUNICAÇÃO COM GOOGLE SHEETS (APPS SCRIPT)
// ==========================================
async function apiSheets(payload) {
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("COLE_AQUI")) {
        alert("Configure a GOOGLE_SCRIPT_URL no arquivo app.js antes de continuar.");
        throw new Error("URL do Apps Script não configurada.");
    }

    const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    });

    return await response.json();
}

function normalizarRegistrosProducao(lista) {
    return (lista || []).map(item => ({
        ...item,
        data: formatSheetDate(item.data),
        produto: String(item.produto || "").trim(),
        descricaoProduto: String(item.descricaoProduto || "").trim(),
        nrOp: String(item.nrOp || "").trim(),
        lote: String(item.lote || "").trim(),
        inicioTurno: formatSheetTime(item.inicioTurno),
        fimTurno: formatSheetTime(item.fimTurno),
        totalParado: formatSheetTime(item.totalParado),
        efetividade: formatSheetOEE(item.efetividade)
    }));
}

function normalizarProgramacao(lista) {
    return (lista || []).map(item => ({
        ...item,
        data: formatSheetDate(item.data),
        maquina: cleanMachineCode(item.maquina),
        nrOp: String(item.nrOp || "").trim(),
        lote: String(item.lote || "").trim(),
        codigoProduto: String(item.codigoProduto || "").trim().toUpperCase(),
        descricaoProduto: String(item.descricaoProduto || "").trim(),
        qtdProgramada: Number(item.qtdProgramada) || 0,
        horasDisponiveis: parseFloat(String(item.horasDisponiveis || 0).replace(",", ".")) || 0,
        horasEstimadas: parseFloat(String(item.horasEstimadas || 0).replace(",", ".")) || 0
    }));
}

async function sincronizarDadosGoogleSheets(mostrarAlerta = false) {
    try {
        const res = await apiSheets({ action: "getAll" });
        if (res.status === "ok") {
            cacheDataRecords = normalizarRegistrosProducao(res.producao);
            cacheProdutosList = res.produtos || [];
            cacheProgramacaoList = normalizarProgramacao(res.programacao);
            cacheUsuariosList = res.usuarios || [];

            cacheDataRecords.sort((a, b) => cleanMachineCode(a.maquina).localeCompare(cleanMachineCode(b.maquina), undefined, { numeric: true }));

            updateLaunchDateFilterOptions();
            applyFilterAndFillTable();
            renderProgramacaoTable();
            atualizarDatalistOpsProgramadas();
            atualizarPainelSaldoOP();
            renderUsersTable();

            const dashTab = document.getElementById('dash');
            if (dashTab && dashTab.classList.contains('active')) {
                buildDashboardAnalyticsUI();
            }

            if (mostrarAlerta) alert("Dados sincronizados com a planilha!");
        }
    } catch (e) {
        console.error("Erro ao sincronizar com Google Sheets:", e);
    }
}

function buscarEPreencherProduto(codigoInput, destino = "apontamento") {
    if (!codigoInput) {
        if (destino === "programacao") atualizarEstimativaHorasCiclo();
        return;
    }
    const idProduto = codigoInput.trim().toUpperCase();

    const produto = cacheProdutosList.find(p => String(p.codigo).trim().toUpperCase() === idProduto);
    if (produto) {
        if (destino === "apontamento") {
            const elCavidades = document.getElementById('form-cav');
            const elCiclo = document.getElementById('form-ciclo');
            const elDesc = document.getElementById('form-prod-desc');

            if (elCavidades && produto.cavidades !== undefined) elCavidades.value = produto.cavidades;
            if (elCiclo && produto.ciclo !== undefined) elCiclo.value = produto.ciclo;
            if (elDesc && produto.descricao && !elDesc.value) elDesc.value = produto.descricao;

            calculateEfficiencyPerformance();
        } else if (destino === "programacao") {
            const elProgDesc = document.getElementById('prog-desc');
            if (elProgDesc && produto.descricao && !elProgDesc.value) {
                elProgDesc.value = produto.descricao;
            }
        }
    }

    if (destino === "programacao") {
        atualizarEstimativaHorasCiclo();
    }
}

// ==========================================
// ESTIMATIVA DE HORAS COM BASE NO CICLO (PROGRAMAR)
// ==========================================
function calcularHorasEstimadasProduto(codigoProduto, qtdProgramada) {
    const codNorm = String(codigoProduto || "").trim().toUpperCase();
    const qtd = Number(qtdProgramada) || 0;
    if (!codNorm || qtd <= 0) return { horas: 0, encontrado: false };

    const prod = cacheProdutosList.find(p => String(p.codigo).trim().toUpperCase() === codNorm);
    if (!prod) return { horas: 0, encontrado: false };

    const ciclo = parseFloat(String(prod.ciclo || 0).replace(",", ".")) || 0;
    const cavidades = parseFloat(String(prod.cavidades || 0).replace(",", ".")) || 0;
    if (ciclo <= 0 || cavidades <= 0) return { horas: 0, encontrado: false };

    const pecasPorHora = (3600 / ciclo) * cavidades;
    const horas = qtd / pecasPorHora;

    return {
        horas: Number(horas.toFixed(1)),
        encontrado: true,
        ciclo,
        cavidades,
        pecasPorHora: Math.round(pecasPorHora)
    };
}

function atualizarEstimativaHorasCiclo() {
    const txtEl = document.getElementById('txt-estimativa-ciclo');
    if (!txtEl) return;

    const cod = document.getElementById('prog-cod') ? document.getElementById('prog-cod').value : "";
    const qtd = document.getElementById('prog-qtd') ? Number(document.getElementById('prog-qtd').value) : 0;
    const hDisp = document.getElementById('prog-horas-disp') ? parseFloat(document.getElementById('prog-horas-disp').value) || 0 : 0;

    if (!cod || qtd <= 0) {
        txtEl.innerHTML = `Informe o <b>Código do Produto</b> e a <b>Qtde a Produzir</b> para calcular as horas estimadas.`;
        return;
    }

    const est = calcularHorasEstimadasProduto(cod, qtd);
    if (!est.encontrado) {
        txtEl.innerHTML = `Produto <b>${cod.toUpperCase()}</b> ainda sem ciclo/cavidades cadastrados. Faça um apontamento deste código para gravar o ciclo automático.`;
        return;
    }

    let comparativoHtml = "";
    if (hDisp > 0) {
        if (est.horas <= hDisp) {
            comparativoHtml = `<span style="color: #15803d; font-weight: 800;">✅ Cabe dentro das ${formatPtNumber(hDisp)}h disponíveis</span>`;
        } else {
            const diff = est.horas - hDisp;
            comparativoHtml = `<span style="color: #b91c1c; font-weight: 800;">⚠️ Excede em +${formatPtNumber(diff)}h as ${formatPtNumber(hDisp)}h disponíveis</span>`;
        }
    }

    txtEl.innerHTML = `
        Parâmetros do molde: <b>${est.cavidades} cavidades</b> · Ciclo: <b>${est.ciclo}s</b> (${est.pecasPorHora.toLocaleString('pt-BR')} pçs/hora)<br>
        Tempo estimado para produzir <b>${qtd.toLocaleString('pt-BR')} peças</b>: <b style="font-size:1rem; color:#1d4ed8;">${formatPtNumber(est.horas)} horas</b> ${comparativoHtml ? ' · ' + comparativoHtml : ''}
    `;
}

// ==========================================
// PROGRAMAÇÃO DE O.P., CÁLCULO DE SALDO E FILTROS
// ==========================================
function calcularProducaoAcumuladaOP(nrOp, excluirIdLancamento = "") {
    if (!nrOp) return 0;
    const opNorm = String(nrOp).trim().toUpperCase();
    return cacheDataRecords.reduce((acc, rec) => {
        if (excluirIdLancamento && String(rec.id) === String(excluirIdLancamento)) return acc;
        if (String(rec.nrOp || "").trim().toUpperCase() === opNorm) {
            return acc + (Number(rec.qtdReal) || 0);
        }
        return acc;
    }, 0);
}

function atualizarDatalistOpsProgramadas() {
    const datalist = document.getElementById('datalist-ops-programadas');
    if (!datalist) return;

    const maqFiltro = document.getElementById('form-maq') ? cleanMachineCode(document.getElementById('form-maq').value) : "";
    datalist.innerHTML = "";

    cacheProgramacaoList.forEach(prog => {
        const jaProd = calcularProducaoAcumuladaOP(prog.nrOp);
        const faltante = Math.max(0, prog.qtdProgramada - jaProd);
        if (!maqFiltro || prog.maquina === maqFiltro) {
            const opt = document.createElement('option');
            opt.value = prog.nrOp;
            opt.label = `INJ-${prog.maquina} | ${prog.codigoProduto} - ${prog.descricaoProduto} (Faltam: ${faltante.toLocaleString('pt-BR')} pçs)`;
            datalist.appendChild(opt);
        }
    });
}

function aoSelecionarOuDigitarOP() {
    const opDigitada = document.getElementById('form-op').value.trim().toUpperCase();
    if (!opDigitada) {
        atualizarPainelSaldoOP();
        return;
    }

    const prog = cacheProgramacaoList.find(p => p.nrOp.toUpperCase() === opDigitada);
    if (prog) {
        const elMaq = document.getElementById('form-maq');
        const elProd = document.getElementById('form-prod');
        const elDesc = document.getElementById('form-prod-desc');
        const elLote = document.getElementById('form-lote');

        if (elMaq && prog.maquina) elMaq.value = prog.maquina;
        if (elProd && prog.codigoProduto) {
            elProd.value = prog.codigoProduto;
            buscarEPreencherProduto(prog.codigoProduto, "apontamento");
        }
        if (elDesc && prog.descricaoProduto) elDesc.value = prog.descricaoProduto;
        if (elLote && prog.lote) elLote.value = prog.lote;
    }

    atualizarPainelSaldoOP();
}

function atualizarPainelSaldoOP() {
    const painel = document.getElementById('painel-saldo-op');
    if (!painel) return;

    const opDigitada = document.getElementById('form-op') ? document.getElementById('form-op').value.trim().toUpperCase() : "";
    if (!opDigitada) {
        painel.style.display = "none";
        return;
    }

    const prog = cacheProgramacaoList.find(p => p.nrOp.toUpperCase() === opDigitada);
    if (!prog) {
        painel.style.display = "none";
        return;
    }

    const editId = document.getElementById('entry-edit-id') ? document.getElementById('entry-edit-id').value : "";
    const jaProduzido = calcularProducaoAcumuladaOP(prog.nrOp, editId);
    const qtdAtualTurno = Number(document.getElementById('form-real').value) || 0;
    const totalComTurno = jaProduzido + qtdAtualTurno;
    const faltante = Math.max(0, prog.qtdProgramada - totalComTurno);

    painel.style.display = "block";
    document.getElementById('op-banner-titulo').innerText = `📋 O.P. ${prog.nrOp} | Lote: ${prog.lote || '-'} | INJ-${prog.maquina}`;
    document.getElementById('op-banner-subtitulo').innerText = `Produto: ${prog.codigoProduto} - ${prog.descricaoProduto} | Horas Disp. Prog.: ${formatPtNumber(prog.horasDisponiveis)}h`;

    document.getElementById('op-stat-prog').innerText = prog.qtdProgramada.toLocaleString('pt-BR');
    document.getElementById('op-stat-ant').innerText = jaProduzido.toLocaleString('pt-BR');
    document.getElementById('op-stat-atual').innerText = qtdAtualTurno.toLocaleString('pt-BR');

    const elFaltante = document.getElementById('op-stat-faltante');
    const elStatus = document.getElementById('op-banner-status');

    elFaltante.innerText = faltante.toLocaleString('pt-BR');
    if (faltante === 0) {
        painel.classList.add('completed');
        elFaltante.style.color = "var(--success)";
        elStatus.className = "op-badge-done";
        elStatus.innerText = "O.P. CONCLUÍDA";
    } else {
        painel.classList.remove('completed');
        elFaltante.style.color = "var(--danger)";
        elStatus.className = "op-badge-open";
        elStatus.innerText = "EM ANDAMENTO";
    }
}

const saveProgBtn = document.getElementById('btn-save-programacao');
if (saveProgBtn) {
    saveProgBtn.onclick = async () => {
        if (!authenticatedUserRef) return;

        const eid = document.getElementById('prog-edit-id').value;
        const data = document.getElementById('prog-data').value.trim();
        const maquina = cleanMachineCode(document.getElementById('prog-maq').value);
        const nrOp = document.getElementById('prog-op').value.trim();
        const lote = document.getElementById('prog-lote').value.trim();
        const codigoProduto = document.getElementById('prog-cod').value.trim().toUpperCase();
        const descricaoProduto = document.getElementById('prog-desc').value.trim();
        const qtdProgramada = Number(document.getElementById('prog-qtd').value) || 0;
        const horasDisponiveis = parseFloat(String(document.getElementById('prog-horas-disp').value).replace(",", ".")) || 0;

        // VALIDAÇÃO OBRIGATÓRIA DE TODOS OS CAMPOS
        if (!data || !maquina || !nrOp || !lote || !codigoProduto || !descricaoProduto || qtdProgramada <= 0 || horasDisponiveis <= 0) {
            alert("Todos os campos da programação são obrigatórios!\nPreencha: Data, Injetora, Nº O.P., Lote, Código do Produto, Qtde a Produzir, Descrição e Horas Disponíveis da Máquina.");
            return;
        }

        const est = calcularHorasEstimadasProduto(codigoProduto, qtdProgramada);
        const horasEstimadas = est.encontrado ? est.horas : 0;

        saveProgBtn.disabled = true;
        saveProgBtn.innerText = "SALVANDO PROGRAMAÇÃO...";

        try {
            const res = await apiSheets({
                action: "saveProgramacao",
                packet: {
                    id: eid || "",
                    data,
                    maquina,
                    nrOp,
                    lote,
                    codigoProduto,
                    descricaoProduto,
                    qtdProgramada,
                    horasDisponiveis,
                    horasEstimadas,
                    criadoPor: authenticatedUserRef.email
                }
            });

            if (res.status === "ok") {
                await sincronizarDadosGoogleSheets();
                alert(eid ? "Programação atualizada com sucesso!" : "O.P. programada com sucesso!");
                resetFormProgramacao();
            } else {
                alert("Erro ao salvar programação: " + (res.message || ""));
            }
        } catch (err) {
            alert(err.message);
        } finally {
            saveProgBtn.disabled = false;
            saveProgBtn.innerText = "SALVAR PROGRAMAÇÃO";
        }
    };
}

function resetFormProgramacao() {
    document.getElementById('prog-edit-id').value = "";
    document.getElementById('prog-maq').value = "";
    document.getElementById('prog-op').value = "";
    document.getElementById('prog-lote').value = "";
    document.getElementById('prog-cod').value = "";
    document.getElementById('prog-desc').value = "";
    document.getElementById('prog-qtd').value = "";
    document.getElementById('prog-horas-disp').value = "";
    document.getElementById('btn-cancel-prog').style.display = "none";
    document.getElementById('btn-save-programacao').innerText = "SALVAR PROGRAMAÇÃO";
    setTodayOnDateField();
    atualizarEstimativaHorasCiclo();
}

const cancelProgBtn = document.getElementById('btn-cancel-prog');
if (cancelProgBtn) cancelProgBtn.onclick = resetFormProgramacao;

function loadProgramacaoToEdit(p) {
    document.getElementById('prog-edit-id').value = p.id;
    document.getElementById('prog-data').value = p.data;
    document.getElementById('prog-maq').value = cleanMachineCode(p.maquina);
    document.getElementById('prog-op').value = p.nrOp;
    document.getElementById('prog-lote').value = p.lote || "";
    document.getElementById('prog-cod').value = p.codigoProduto;
    document.getElementById('prog-desc').value = p.descricaoProduto || "";
    document.getElementById('prog-qtd').value = p.qtdProgramada;
    document.getElementById('prog-horas-disp').value = p.horasDisponiveis || "";

    document.getElementById('btn-cancel-prog').style.display = "block";
    document.getElementById('btn-save-programacao').innerText = "ALTERAR PROGRAMAÇÃO";
    atualizarEstimativaHorasCiclo();
}

window.limparFiltrosProgramacao = function() {
    const ids = [
        'f-prog-data', 'f-prog-inj', 'f-prog-op', 'f-prog-lote',
        'f-prog-cod', 'f-prog-desc', 'f-prog-hdisp', 'f-prog-hest',
        'f-prog-qtd', 'f-prog-prod', 'f-prog-falt', 'f-prog-status'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    renderProgramacaoTable();
};

function renderProgramacaoTable() {
    const tbody = document.getElementById('table-programacao-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    const getF = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim().toLowerCase() : "";
    };

    const fData = getF('f-prog-data');
    const fInj = getF('f-prog-inj');
    const fOp = getF('f-prog-op');
    const fLote = getF('f-prog-lote');
    const fCod = getF('f-prog-cod');
    const fDesc = getF('f-prog-desc');
    const fHdisp = getF('f-prog-hdisp');
    const fHest = getF('f-prog-hest');
    const fQtd = getF('f-prog-qtd');
    const fProd = getF('f-prog-prod');
    const fFalt = getF('f-prog-falt');
    const fStatus = getF('f-prog-status');

    const listaEnriquecida = cacheProgramacaoList
        .map(p => {
            const produzido = calcularProducaoAcumuladaOP(p.nrOp);
            const faltante = Math.max(0, p.qtdProgramada - produzido);
            const concluida = faltante === 0;
            const statusText = concluida ? 'CONCLUÍDA' : 'EM ABERTO';
            const dataFormatada = String(p.data).split('-').reverse().join('/');
            const injCode = cleanMachineCode(p.maquina);

            const estCalc = calcularHorasEstimadasProduto(p.codigoProduto, p.qtdProgramada);
            const horasEst = estCalc.encontrado ? estCalc.horas : (p.horasEstimadas || 0);

            return {
                ...p,
                produzido,
                faltante,
                concluida,
                statusText,
                dataFormatada,
                injCode,
                horasEst
            };
        })
        .filter(item => {
            if (fData && !item.dataFormatada.toLowerCase().includes(fData) && !String(item.data).includes(fData)) return false;
            if (fInj && item.injCode !== cleanMachineCode(fInj)) return false;
            if (fOp && !String(item.nrOp).toLowerCase().includes(fOp)) return false;
            if (fLote && !String(item.lote || '').toLowerCase().includes(fLote)) return false;
            if (fCod && !String(item.codigoProduto).toLowerCase().includes(fCod)) return false;
            if (fDesc && !String(item.descricaoProduto || '').toLowerCase().includes(fDesc)) return false;
            if (fHdisp && !formatPtNumber(item.horasDisponiveis).includes(fHdisp) && !String(item.horasDisponiveis).includes(fHdisp)) return false;
            if (fHest && !formatPtNumber(item.horasEst).includes(fHest) && !String(item.horasEst).includes(fHest)) return false;
            if (fQtd && !String(item.qtdProgramada).includes(fQtd) && !item.qtdProgramada.toLocaleString('pt-BR').includes(fQtd)) return false;
            if (fProd && !String(item.produzido).includes(fProd) && !item.produzido.toLocaleString('pt-BR').includes(fProd)) return false;
            if (fFalt && !String(item.faltante).includes(fFalt) && !item.faltante.toLocaleString('pt-BR').includes(fFalt)) return false;
            if (fStatus && item.statusText.toLowerCase() !== fStatus) return false;
            return true;
        })
        .sort((a, b) => String(b.data).localeCompare(String(a.data)));

    if (listaEnriquecida.length === 0) {
        tbody.innerHTML = `<tr><td colspan="13" style="text-align:center; color:#64748b; padding:20px;">Nenhuma O.P. encontrada para os filtros informados</td></tr>`;
        return;
    }

    listaEnriquecida.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${p.dataFormatada}</b></td>
            <td><b>INJ-${p.injCode}</b></td>
            <td><b>${p.nrOp}</b></td>
            <td>${p.lote || '-'}</td>
            <td>${p.codigoProduto}</td>
            <td>${p.descricaoProduto || '-'}</td>
            <td><b>${formatPtNumber(p.horasDisponiveis)}h</b></td>
            <td style="color:#475569;">${p.horasEst > 0 ? formatPtNumber(p.horasEst) + 'h' : '-'}</td>
            <td><b>${p.qtdProgramada.toLocaleString('pt-BR')}</b></td>
            <td style="color:var(--primary-blue); font-weight:700;">${p.produzido.toLocaleString('pt-BR')}</td>
            <td style="color:${p.concluida ? 'var(--success)' : 'var(--danger)'}; font-weight:800;">${p.faltante.toLocaleString('pt-BR')}</td>
            <td><span class="${p.concluida ? 'op-badge-done' : 'op-badge-open'}">${p.statusText}</span></td>
            <td style="display:flex; gap:6px;">
                <button class="btn-submit-system" style="padding:5px 8px; font-size:0.72rem;" id="edt-prog-${p.id}">EDITAR</button>
                <button style="background:var(--danger); border:none; color:white; padding:5px 8px; border-radius:6px; font-weight:bold; cursor:pointer;" id="del-prog-${p.id}">X</button>
            </td>
        `;

        tr.querySelector(`#edt-prog-${p.id}`).onclick = () => loadProgramacaoToEdit(p);
        tr.querySelector(`#del-prog-${p.id}`).onclick = async () => {
            if (confirm(`Excluir a programação da O.P. ${p.nrOp}?`)) {
                await apiSheets({ action: "deleteProgramacao", id: p.id });
                await sincronizarDadosGoogleSheets();
            }
        };

        tbody.appendChild(tr);
    });
}

// ==========================================
// INICIALIZAÇÃO, SETUP E LOGIN
// ==========================================
async function verifyInitialSetupSystem() {
    const statusMsg = document.getElementById('login-status-msg');
    try {
        const res = await apiSheets({ action: "getAll" });
        if (res.status === "ok") {
            cacheDataRecords = normalizarRegistrosProducao(res.producao);
            cacheProdutosList = res.produtos || [];
            cacheProgramacaoList = normalizarProgramacao(res.programacao);
            cacheUsuariosList = res.usuarios || [];

            if (cacheUsuariosList.length === 0) {
                document.getElementById('setup-screen').style.display = 'flex';
                document.getElementById('auth-screen').style.display = 'none';
            } else {
                if (statusMsg) statusMsg.innerText = "Acesso ao Controle de Produção";
                const savedSession = sessionStorage.getItem("prodtech_user");
                if (savedSession) {
                    aplicarSessaoLogada(JSON.parse(savedSession));
                } else {
                    document.getElementById('setup-screen').style.display = 'none';
                    document.getElementById('auth-screen').style.display = 'flex';
                }
            }
        }
    } catch (e) {
        if (statusMsg) statusMsg.innerText = "Erro de conexão com a planilha.";
    }
}

const setupBtn = document.getElementById('btn-save-setup');
if (setupBtn) {
    setupBtn.onclick = async () => {
        const email = document.getElementById('setup-email').value.trim().toLowerCase();
        const pass = document.getElementById('setup-senha').value;
        if (!email.includes('@') || pass.length < 6) { alert("Insira um e-mail válido e senha com no mínimo 6 caracteres."); return; }

        setupBtn.disabled = true;
        setupBtn.innerText = "CRIANDO...";
        try {
            const res = await apiSheets({ action: "setupAdmin", email, senha: pass });
            if (res.status === "ok" && res.user) {
                await sincronizarDadosGoogleSheets();
                aplicarSessaoLogada(res.user);
            } else {
                alert(res.message || "Erro ao criar administrador.");
            }
        } catch (err) {
            alert(err.message);
        } finally {
            setupBtn.disabled = false;
            setupBtn.innerText = "CRIAR ADMINISTRADOR";
        }
    };
}

const loginBtn = document.getElementById('btn-login');
if (loginBtn) {
    loginBtn.onclick = async () => {
        const email = document.getElementById('login-email').value.trim().toLowerCase();
        const pass = document.getElementById('login-senha').value;
        const errBox = document.getElementById('login-erro-banner');

        if (!email || !pass) {
            if (errBox) { errBox.innerText = "Preencha e-mail e senha."; errBox.style.display = "block"; }
            return;
        }

        loginBtn.disabled = true;
        loginBtn.innerText = "ENTRANDO...";
        if (errBox) errBox.style.display = "none";

        try {
            const res = await apiSheets({ action: "login", email, senha: pass });
            if (res.status === "ok" && res.user) {
                await sincronizarDadosGoogleSheets();
                aplicarSessaoLogada(res.user);
            } else {
                if (errBox) { errBox.innerText = res.message || "Credenciais inválidas."; errBox.style.display = "block"; }
            }
        } catch (e) {
            if (errBox) { errBox.innerText = "Falha na conexão com o Google Sheets."; errBox.style.display = "block"; }
        } finally {
            loginBtn.disabled = false;
            loginBtn.innerText = "ENTRAR NO SISTEMA";
        }
    };
}

function aplicarSessaoLogada(user) {
    authenticatedUserRef = user;
    sessionStorage.setItem("prodtech_user", JSON.stringify(user));

    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';

    activeUserRoleAdmin = (user.role === 'adm');
    document.getElementById('user-display').innerHTML = `${activeUserRoleAdmin ? 'Administrador' : 'Operador'}:<br>${user.email}`;

    if (activeUserRoleAdmin) {
        if (document.getElementById('menu-adm-gate')) document.getElementById('menu-adm-gate').style.display = 'flex';
        if (document.getElementById('box-filter-user-adm')) document.getElementById('box-filter-user-adm').style.display = 'block';
        renderUsersTable();
    } else {
        if (document.getElementById('menu-adm-gate')) document.getElementById('menu-adm-gate').style.display = 'none';
        if (document.getElementById('box-filter-user-adm')) document.getElementById('box-filter-user-adm').style.display = 'none';
    }

    updateLaunchDateFilterOptions();
    applyFilterAndFillTable();
    renderProgramacaoTable();
    atualizarDatalistOpsProgramadas();
}

window.triggerSystemLogout = () => {
    authenticatedUserRef = null;
    sessionStorage.removeItem("prodtech_user");
    document.getElementById('app-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
    window.switchViewTab('calc');
};

window.switchViewTab = (id) => {
    document.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.sidebar-nav-item').forEach(b => b.classList.remove('active'));
    
    const targetView = document.getElementById(id);
    if (targetView) targetView.classList.add('active');
    
    const targetTab = document.getElementById(`tab-link-${id}`);
    if (targetTab) targetTab.classList.add('active');

    if (id === 'dash') {
        buildDashboardAnalyticsUI();
    } else if (id === 'prog') {
        renderProgramacaoTable();
        atualizarEstimativaHorasCiclo();
    } else if (id === 'calc') {
        atualizarDatalistOpsProgramadas();
        atualizarPainelSaldoOP();
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
// CÁLCULO DE OEE NO APONTAMENTO (DISP × PERF × QUAL)
// ==========================================
function calculateEfficiencyPerformance() {
    const getVal = (id) => { const el = document.getElementById(id); return el && el.value ? el.value : ""; };
    const getNum = (id) => { const el = document.getElementById(id); return el && el.value ? parseFloat(el.value) || 0 : 0; };

    const strIni = getVal('form-ini');
    const strFim = getVal('form-fim');

    if (!strIni || !strFim) {
        if (document.getElementById('oee-pct')) document.getElementById('oee-pct').innerText = '0%';
        if (document.getElementById('oee-target')) document.getElementById('oee-target').innerText = 'meta=0';
        return;
    }

    const tIni = strIni.split(':').map(v => parseInt(v, 10) || 0);
    const tFim = strFim.split(':').map(v => parseInt(v, 10) || 0);
    const pTime = (getVal('form-total-parada') || "00:00").split(':').map(v => parseInt(v, 10) || 0);

    let totalTurno = (tFim[0] * 60 + tFim[1]) - (tIni[0] * 60 + tIni[1]);
    if (totalTurno < 0) totalTurno += 1440; 

    let totalParada = (pTime[0] * 60) + pTime[1];
    let prodTimeMinutos = Math.max(0, totalTurno - totalParada);

    const ciclo = getNum('form-ciclo');
    const maxCav = getNum('form-cav');
    const boas = getNum('form-real');
    const refugoProc = getNum('form-refugo');
    const refugoSetup = getNum('form-refugo-setup');
    const totalRefugo = refugoProc + refugoSetup;
    const totalProduzido = boas + totalRefugo;

    // 1. Disponibilidade do Turno
    const disp = totalTurno > 0 ? (prodTimeMinutos / totalTurno) : 0;

    // 2. Performance (Total Produzido / Teórico no tempo produtivo)
    let teorico = 0;
    if (ciclo > 0 && maxCav > 0) {
        const pecasPorHora = (3600 / ciclo) * maxCav;
        teorico = Math.floor(pecasPorHora * (prodTimeMinutos / 60));
    }
    const perf = teorico > 0 ? (totalProduzido / teorico) : 0;

    // 3. Qualidade (Peças Boas / Total Produzido)
    const qual = totalProduzido > 0 ? (boas / totalProduzido) : 0;

    // OEE = Disponibilidade x Performance x Qualidade
    const oee = Math.round(disp * perf * qual * 100);
    
    const oeePctEl = document.getElementById('oee-pct');
    const oeeTargetEl = document.getElementById('oee-target');
    if (oeePctEl) oeePctEl.innerText = `${oee}%`;
    if (oeeTargetEl) oeeTargetEl.innerText = `meta=${teorico} | Disp ${(disp*100).toFixed(0)}% · Perf ${(perf*100).toFixed(0)}% · Qual ${(qual*100).toFixed(0)}%`;

    const display = document.querySelector('.oee-box-display');
    if (display) {
        if (oee >= 85) display.style.background = "var(--success)";
        else if (oee >= 60) display.style.background = "var(--accent)";
        else display.style.background = "var(--danger)";
    }
}

['form-ini', 'form-fim', 'form-ciclo', 'form-cav', 'form-real', 'form-refugo', 'form-refugo-setup'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('input', () => {
            calculateEfficiencyPerformance();
            if (id === 'form-real') atualizarPainelSaldoOP();
        });
        el.addEventListener('change', () => {
            calculateEfficiencyPerformance();
            if (id === 'form-real') atualizarPainelSaldoOP();
        });
    }
});

// ==========================================
// PERSISTÊNCIA GOOGLE SHEETS (CRUD)
// ==========================================
const saveProdBtn = document.getElementById('btn-save-production');
if (saveProdBtn) {
    saveProdBtn.onclick = async () => {
        if (!authenticatedUserRef) return;
        const eid = document.getElementById('entry-edit-id').value;
        const data = document.getElementById('form-data').value;
        const rawMaq = document.getElementById('form-maq').value;
        const maq = cleanMachineCode(rawMaq);
        const prod = document.getElementById('form-prod').value.trim().toUpperCase();

        if (!data || !maq || !prod) { alert("Data, Máquina e Cód produto são obrigatórios!"); return; }

        const paradasTratadas = listaParadasLancadas.map(p => ({ ...p, cod: pad2(p.cod) }));
        const cavVal = Number(document.getElementById('form-cav').value) || 0;
        const cicloVal = Number(document.getElementById('form-ciclo').value) || 0;

        const packet = {
            id: eid || "",
            data, 
            nomeOperador: document.getElementById('form-nome').value.trim(),
            maquina: maq, 
            produto: prod,
            descricaoProduto: document.getElementById('form-prod-desc').value.trim(),
            nrOp: document.getElementById('form-op').value.trim(),
            lote: document.getElementById('form-lote').value.trim(),
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
            paradasMapeadas: paradasTratadas,
            criadoPor: authenticatedUserRef.email
        };

        saveProdBtn.disabled = true;
        saveProdBtn.innerText = "SALVANDO NA PLANILHA...";

        try {
            const res = await apiSheets({ action: "saveProducao", packet });
            if (res.status === "ok") {
                await sincronizarDadosGoogleSheets();
                alert(eid ? "Atualizado na planilha com sucesso!" : "Salvo na planilha com sucesso!");
                resetInputsFormLancamento();
            } else {
                alert("Erro ao salvar: " + (res.message || ""));
            }
        } catch (err) {
            alert(err.message);
        } finally {
            saveProdBtn.disabled = false;
            saveProdBtn.innerText = "SALVAR REGISTRO";
        }
    };
}

function resetInputsFormLancamento() {
    if (document.getElementById('entry-edit-id')) document.getElementById('entry-edit-id').value = "";
    if (document.getElementById('form-nome')) document.getElementById('form-nome').value = "";
    if (document.getElementById('form-maq')) document.getElementById('form-maq').value = "";
    if (document.getElementById('form-prod')) document.getElementById('form-prod').value = "";
    if (document.getElementById('form-prod-desc')) document.getElementById('form-prod-desc').value = "";
    if (document.getElementById('form-op')) document.getElementById('form-op').value = "";
    if (document.getElementById('form-lote')) document.getElementById('form-lote').value = "";
    if (document.getElementById('form-refugo')) document.getElementById('form-refugo').value = "0";
    if (document.getElementById('form-refugo-setup')) document.getElementById('form-refugo-setup').value = "0";
    if (document.getElementById('form-obs')) document.getElementById('form-obs').value = "";
    if (document.getElementById('form-real')) document.getElementById('form-real').value = "";
    if (document.getElementById('form-ciclo')) document.getElementById('form-ciclo').value = "";
    if (document.getElementById('form-cav')) document.getElementById('form-cav').value = "";
    if (document.getElementById('form-total-parada')) document.getElementById('form-total-parada').value = "00:00";
    if (document.getElementById('display-total-parada')) document.getElementById('display-total-parada').innerText = "00:00";
    if (document.getElementById('painel-saldo-op')) document.getElementById('painel-saldo-op').style.display = "none";

    listaParadasLancadas = [];

    if (document.getElementById('btn-cancel-edit')) document.getElementById('btn-cancel-edit').style.display = 'none';
    if (document.getElementById('btn-delete-entry')) document.getElementById('btn-delete-entry').style.display = 'none';
    if (document.getElementById('btn-save-production')) document.getElementById('btn-save-production').innerText = "SALVAR REGISTRO";
    
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
        if (id && confirm("Excluir definitivamente da planilha?")) {
            deleteEntryBtn.disabled = true;
            await apiSheets({ action: "deleteProducao", id });
            await sincronizarDadosGoogleSheets();
            deleteEntryBtn.disabled = false;
            resetInputsFormLancamento();
        }
    };
}

function updateLaunchDateFilterOptions() {
    const selectEl = document.getElementById('filter-launch-date');
    if (!selectEl || !authenticatedUserRef) return;
    
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

// ==========================================
// FILTROS E TABELA DE RELATÓRIO
// ==========================================
function applyFilterAndFillTable() {
    if (!authenticatedUserRef) return;

    const fLaunchDate = document.getElementById('filter-launch-date') ? document.getElementById('filter-launch-date').value : "";
    const fStart = document.getElementById('filter-start-date') ? document.getElementById('filter-start-date').value : "";
    const fEnd = document.getElementById('filter-end-date') ? document.getElementById('filter-end-date').value : "";
    const fMaq = document.getElementById('filter-maq') ? cleanMachineCode(document.getElementById('filter-maq').value) : "";
    const fProd = document.getElementById('filter-prod') ? document.getElementById('filter-prod').value.trim().toLowerCase() : "";
    const fUser = document.getElementById('filter-user') ? document.getElementById('filter-user').value.trim().toLowerCase() : "";

    let res = cacheDataRecords.filter(i => {
        if (!activeUserRoleAdmin && i.criadoPor !== authenticatedUserRef.email) return false;
        if (fLaunchDate) { if (i.data !== fLaunchDate) return false; } 
        else {
            if (fStart && i.data < fStart) return false;
            if (fEnd && i.data > fEnd) return false;
        }
        if (fMaq && !cleanMachineCode(i.maquina).includes(fMaq)) return false;
        if (fProd && !String(i.produto).toLowerCase().includes(fProd)) return false;
        if (fUser && activeUserRoleAdmin && !String(i.criadoPor).toLowerCase().includes(fUser)) return false;
        return true;
    });

    const body = document.getElementById('table-entries-body');
    if (!body) return;
    body.innerHTML = "";

    if (res.length === 0) {
        body.innerHTML = `<tr><td colspan="20" style="text-align:center; color:#64748b; padding:20px;">Nenhum registro encontrado</td></tr>`;
        return;
    }

    res.forEach(i => {
        const tr = document.createElement('tr');
        
        let det = (Array.isArray(i.paradasMapeadas) && i.paradasMapeadas.length > 0)
            ? i.paradasMapeadas.map(p => {
                const codForm = pad2(p.cod);
                return `• ${codForm} - ${p.desc || ''} (${p.tot || p.totMin + ' min'})${p.ocorrencia ? ` - ${p.ocorrencia}` : ''}`;
            }).join('<br>')
            : 'Nenhuma';

        const maqFormatada = cleanMachineCode(i.maquina);

        tr.innerHTML = `
            <td><b>${String(i.data).split('-').reverse().slice(0,2).join('/')}</b></td>
            <td>${i.nomeOperador || '-'}</td>
            <td><b>${maqFormatada}</b></td>
            <td>${i.produto}</td>
            <td>${i.descricaoProduto || '-'}</td>
            <td>${i.nrOp || '-'}</td>
            <td>${i.lote || '-'}</td>
            <td>${i.inicioTurno}</td><td>${i.fimTurno}</td><td>${i.qtdReal}</td><td>${i.qtdRefugo || 0}</td><td>${i.qtdRefugoSetup || 0}</td>
            <td>${i.cavidades || 0}</td><td>${i.ciclo || 0}</td>
            <td><b style="color:${Number(String(i.efetividade).replace('%','') || 0)>=85?'var(--success)':'var(--accent)'}">${i.efetividade || '0%'}</b></td>
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
    document.getElementById('form-prod-desc').value = i.descricaoProduto || "";
    document.getElementById('form-op').value = i.nrOp || "";
    document.getElementById('form-lote').value = i.lote || "";
    document.getElementById('form-refugo').value = i.qtdRefugo || "0";
    document.getElementById('form-refugo-setup').value = i.qtdRefugoSetup || "0";
    document.getElementById('form-ciclo').value = i.ciclo;
    document.getElementById('form-cav').value = i.cavidades;
    document.getElementById('form-real').value = i.qtdReal;
    document.getElementById('form-obs').value = i.obs || "";

    buildDowntimeCheckboxesUI();
    
    listaParadasLancadas = (Array.isArray(i.paradasMapeadas) ? i.paradasMapeadas : []).map(p => ({
        ...p,
        cod: pad2(p.cod)
    }));

    renderizarListaParadasAdicionadas();
    
    document.getElementById('form-total-parada').value = i.totalParado || "00:00";
    if (document.getElementById('display-total-parada')) document.getElementById('display-total-parada').innerText = i.totalParado || "00:00";
    
    document.getElementById('btn-cancel-edit').style.display = 'block';
    document.getElementById('btn-delete-entry').style.display = 'block';
    document.getElementById('btn-save-production').innerText = "ALTERAR REGISTRO";
    calculateEfficiencyPerformance();
    atualizarPainelSaldoOP();
}

['filter-launch-date', 'filter-start-date', 'filter-end-date', 'filter-maq', 'filter-prod', 'filter-user'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { 
        el.oninput = () => { applyFilterAndFillTable(); if (document.getElementById('dash').classList.contains('active')) buildDashboardAnalyticsUI(); }; 
        el.onchange = applyFilterAndFillTable; 
    }
});

const csvBtn = document.getElementById('btn-trigger-csv-export');
if (csvBtn) {
    csvBtn.onclick = () => {
        let res = cacheDataRecords;
        if (res.length === 0) { alert("Nenhum registro para exportar!"); return; }
        let csv = "Data;Nome Operador;Maquina;Produto;Descricao;OP;Lote;Refugo;Refugo Setup;Inicio;Fim;Cavidades;Ciclo;Total Paradas;Real;Efetividade;Criador\n";
        res.forEach(i => { csv += `${i.data};${i.nomeOperador || ''};${cleanMachineCode(i.maquina)};${i.produto};${i.descricaoProduto || ''};${i.nrOp || ''};${i.lote || ''};${i.qtdRefugo || 0};${i.qtdRefugoSetup || 0};${i.inicioTurno};${i.fimTurno};${i.cavidades};${i.ciclo};${i.totalParado};${i.qtdReal};${i.efetividade};${i.criadoPor}\n`; });
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `PROD_TECH_Export.csv`;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };
}

// ==========================================
// PAINEL ADMINISTRATIVO DE USUÁRIOS
// ==========================================
function renderUsersTable() {
    const tbody = document.getElementById('table-users-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    cacheUsuariosList.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${u.email}</td><td><code>${u.senha}</code></td><td>${u.role}</td><td><button style="background:var(--danger); border:none; color:white; padding:4px 8px; border-radius:4px; cursor:pointer;" id="d-usr-${u.id}">X</button></td>`;
        tr.querySelector(`#d-usr-${u.id}`).onclick = async () => {
            if (confirm("Excluir conta da planilha?")) {
                await apiSheets({ action: "deleteUser", id: u.id });
                await sincronizarDadosGoogleSheets();
            }
        };
        tbody.appendChild(tr);
    });
}

const createOpBtn = document.getElementById('btn-create-operator');
if (createOpBtn) {
    createOpBtn.onclick = async () => {
        const email = document.getElementById('adm-new-user-email').value.trim().toLowerCase();
        const senhaEl = document.getElementById('adm-new-user-senha');
        const senha = senhaEl ? senhaEl.value.trim() : "123456";

        if (!email || !email.includes('@')) { alert("Insira um e-mail válido!"); return; }
        if (!senha || senha.length < 4) { alert("Insira uma senha com pelo menos 4 caracteres!"); return; }

        createOpBtn.disabled = true;
        createOpBtn.innerText = "CADASTRANDO...";
        try {
            const res = await apiSheets({ action: "addUser", email, senha, role: "operador" });
            if (res.status === "ok") {
                await sincronizarDadosGoogleSheets();
                alert("Operador cadastrado com sucesso na planilha!");
                document.getElementById('adm-new-user-email').value = "";
                if (senhaEl) senhaEl.value = "";
            } else {
                alert(res.message || "Erro ao cadastrar operador.");
            }
        } catch (e) {
            alert("Erro ao registrar: " + e.message);
        } finally {
            createOpBtn.disabled = false;
            createOpBtn.innerText = "CADASTRAR OPERADOR";
        }
    };
}

function setTodayOnDateField() {
    const hoje = new Date();
    const tzOffset = hoje.getTimezoneOffset() * 60000;
    const hojeStr = new Date(hoje.getTime() - tzOffset).toISOString().slice(0, 10);

    const dateEl = document.getElementById('form-data');
    if (dateEl) dateEl.value = hojeStr;

    const progDateEl = document.getElementById('prog-data');
    if (progDateEl) progDateEl.value = hojeStr;
}

// ==========================================
// CONSTRUÇÃO DO DASHBOARD OEE (DISP × PERF × QUAL)
// ==========================================
function filtrarItemPorPeriodoDash(dataItem) {
    if (dashPeriodoAtual === 'ontem') {
        const dataOntem = new Date();
        dataOntem.setDate(dataOntem.getDate() - 1);
        const tzOffset = dataOntem.getTimezoneOffset() * 60000;
        const dataOntemStr = new Date(dataOntem.getTime() - tzOffset).toISOString().slice(0, 10);
        return dataItem === dataOntemStr;
    } 
    else if (dashPeriodoAtual === 'mes_especifico') {
        const selectMes = document.getElementById('dash-select-mes');
        if (selectMes && selectMes.value) {
            const mesSel = parseInt(selectMes.value, 10);
            if (!dataItem) return false;
            const partes = String(dataItem).split('-');
            const mesItem = parseInt(partes[1], 10);
            return mesItem === mesSel;
        }
    } 
    else if (dashPeriodoAtual === 'especifica') {
        const selectDataEspecifica = document.getElementById('dash-select-data-lancada');
        if (selectDataEspecifica && selectDataEspecifica.value) {
            return dataItem === selectDataEspecifica.value;
        }
    }
    return true;
}

function aplicarCorCardOEE(cardId, valId, pct) {
    const card = document.getElementById(cardId);
    const valEl = document.getElementById(valId);
    if (!card || !valEl) return;

    let color = "#16a34a"; // Verde (>= 85%)
    if (pct < 60) color = "#ef4444"; // Vermelho (< 60%)
    else if (pct < 85) color = "#f59e0b"; // Laranja (60% - 84.9%)

    card.style.borderLeftColor = color;
    valEl.style.color = color;
}

function buildDashboardAnalyticsUI() {
    if (!authenticatedUserRef) return;

    const fLaunchDate = document.getElementById('filter-launch-date') ? document.getElementById('filter-launch-date').value : "";
    const fStart = document.getElementById('filter-start-date') ? document.getElementById('filter-start-date').value : "";
    const fEnd = document.getElementById('filter-end-date') ? document.getElementById('filter-end-date').value : "";
    const fMaqGeral = document.getElementById('filter-maq') ? cleanMachineCode(document.getElementById('filter-maq').value) : "";
    const fProd = document.getElementById('filter-prod') ? document.getElementById('filter-prod').value.trim().toLowerCase() : "";
    const fUser = document.getElementById('filter-user') ? document.getElementById('filter-user').value.trim().toLowerCase() : "";

    const dashMaqSelect = document.getElementById('dash-select-maquina');
    const maqSelecionadaDash = dashMaqSelect ? cleanMachineCode(dashMaqSelect.value) : "";

    // 1. Filtra apontamentos de produção
    let dadosFiltrados = cacheDataRecords.filter(i => {
        if (!activeUserRoleAdmin && i.criadoPor !== authenticatedUserRef.email) return false;
        if (!filtrarItemPorPeriodoDash(i.data)) return false;

        if (fLaunchDate) { if (i.data !== fLaunchDate) return false; } 
        else {
            if (fStart && i.data < fStart) return false;
            if (fEnd && i.data > fEnd) return false;
        }
        if (fMaqGeral && !cleanMachineCode(i.maquina).includes(fMaqGeral)) return false;
        if (fProd && !String(i.produto).toLowerCase().includes(fProd)) return false;
        if (fUser && activeUserRoleAdmin && !String(i.criadoPor).toLowerCase().includes(fUser)) return false;
        return true;
    });

    // 2. Filtra programação correspondente para obter Horas Disponíveis Programadas
    let progFiltrada = cacheProgramacaoList.filter(p => {
        if (!filtrarItemPorPeriodoDash(p.data)) return false;
        if (fLaunchDate) { if (p.data !== fLaunchDate) return false; }
        else {
            if (fStart && p.data < fStart) return false;
            if (fEnd && p.data > fEnd) return false;
        }
        if (fMaqGeral && !cleanMachineCode(p.maquina).includes(fMaqGeral)) return false;
        if (fProd && !String(p.codigoProduto).toLowerCase().includes(fProd)) return false;
        if (maqSelecionadaDash && cleanMachineCode(p.maquina) !== maqSelecionadaDash) return false;
        return true;
    });

    atualizarSelectDatasLancadasDash(cacheDataRecords);

    // Gráfico Produção por Injetora (INJ-01 a INJ-13)
    let prodPorInjetora = Array(LISTA_INJETORAS.length).fill(0);
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
                datasets: [{ label: 'Total Peças Produzidas', data: prodPorInjetora, backgroundColor: '#3b82f6', borderRadius: 4 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
    }

    // Escopo OEE (todas as máquinas ou máquina selecionada no filtro)
    let escopoOEE = dadosFiltrados;
    if (maqSelecionadaDash) {
        escopoOEE = dadosFiltrados.filter(i => cleanMachineCode(i.maquina) === maqSelecionadaDash);
    }

    const lblPareto = document.getElementById('lbl-pareto-titulo');
    if (lblPareto) {
        lblPareto.innerText = maqSelecionadaDash 
            ? `Pareto de Paradas (Minutos) - Máquina ${maqSelecionadaDash}` 
            : `Pareto de Paradas (Minutos) - Todas as Máquinas`;
    }

    let totalMinutosParados = 0;
    let totalMinutosTurnoBruto = 0;
    let totalPecasBoas = 0;
    let totalRefugo = 0;
    let totalPecasTeoricas = 0;
    let mapaParadas = {};

    escopoOEE.forEach(i => {
        let minParadoItem = 0;
        if (i.totalParado) {
            const parts = String(i.totalParado).split(':').map(Number);
            minParadoItem = (parts[0] * 60) + (parts[1] || 0);
            totalMinutosParados += minParadoItem;
        }

        let minBrutoItem = 0;
        if (i.inicioTurno && i.fimTurno) {
            const stringsIni = String(i.inicioTurno).split(':').map(Number);
            const stringsFim = String(i.fimTurno).split(':').map(Number);
            let dMin = (stringsFim[0] * 60 + stringsFim[1]) - (stringsIni[0] * 60 + stringsIni[1]);
            if (dMin < 0) dMin += 1440;
            minBrutoItem = dMin;
            totalMinutosTurnoBruto += dMin;
        }

        const minProdItem = Math.max(0, minBrutoItem - minParadoItem);
        const cicloItem = parseFloat(String(i.ciclo || 0).replace(",", ".")) || 0;
        const cavItem = parseFloat(String(i.cavidades || 0).replace(",", ".")) || 0;

        if (cicloItem > 0 && cavItem > 0 && minProdItem > 0) {
            const pecasPorHora = (3600 / cicloItem) * cavItem;
            totalPecasTeoricas += Math.floor(pecasPorHora * (minProdItem / 60));
        }

        totalPecasBoas += (Number(i.qtdReal) || 0);
        totalRefugo += (Number(i.qtdRefugo) || 0) + (Number(i.qtdRefugoSetup) || 0);

        if (Array.isArray(i.paradasMapeadas)) {
            i.paradasMapeadas.forEach(p => {
                let mMin = p.totMin !== undefined ? (parseInt(p.totMin) || 0) : (parseInt(String(p.tot).replace(' min', '')) || 0);
                const codPadronizado = pad2(p.cod);
                const motivoObj = MOTIVOS_PARADAS_DATA.find(m => pad2(m.cod) === codPadronizado);
                const descFinal = p.desc || (motivoObj ? motivoObj.desc : `Parada ${codPadronizado}`);
                let identificador = `${codPadronizado} - ${descFinal}`;
                mapaParadas[identificador] = (mapaParadas[identificador] || 0) + mMin;
            });
        }
    });

    const totalMinutosProdutivos = Math.max(0, totalMinutosTurnoBruto - totalMinutosParados);
    const horasProdutivas = totalMinutosProdutivos / 60;
    const horasTurnoBruto = totalMinutosTurnoBruto / 60;

    // Soma das Horas Disponíveis programadas
    const horasDisponiveisProgramadas = progFiltrada.reduce((acc, p) => acc + (Number(p.horasDisponiveis) || 0), 0);
    // Base oficial de horas disponíveis (usa a programação se existir; senão usa o tempo bruto apontado)
    const baseHorasDisponiveis = horasDisponiveisProgramadas > 0 ? horasDisponiveisProgramadas : horasTurnoBruto;

    // ========================================================
    // CÁLCULO OFICIAL OEE: DISPONIBILIDADE × PERFORMANCE × QUALIDADE
    // ========================================================
    const dispFator = baseHorasDisponiveis > 0 ? Math.min(1, horasProdutivas / baseHorasDisponiveis) : 0;
    const totalPecasProduzidas = totalPecasBoas + totalRefugo;
    const perfFator = totalPecasTeoricas > 0 ? (totalPecasProduzidas / totalPecasTeoricas) : 0;
    const qualFator = totalPecasProduzidas > 0 ? (totalPecasBoas / totalPecasProduzidas) : 0;

    const dispPct = Number((dispFator * 100).toFixed(1));
    const perfPct = Number((perfFator * 100).toFixed(1));
    const qualPct = Number((qualFator * 100).toFixed(1));
    const oeePct = Number((dispFator * perfFator * qualFator * 100).toFixed(1));

    // Atualiza Cards Estilo ooe.jpg
    document.getElementById('oee-val-disp').innerText = `${formatPtNumber(dispPct)}%`;
    document.getElementById('oee-sub-disp').innerText = `${formatPtNumber(baseHorasDisponiveis)}h de base · regra oficial da aba OEE`;
    aplicarCorCardOEE('card-oee-disp', 'oee-val-disp', dispPct);

    document.getElementById('oee-val-perf').innerText = `${formatPtNumber(perfPct)}%`;
    document.getElementById('oee-sub-perf').innerText = `${totalPecasProduzidas.toLocaleString('pt-BR')} produzidas / ${totalPecasTeoricas.toLocaleString('pt-BR')} teóricas`;
    aplicarCorCardOEE('card-oee-perf', 'oee-val-perf', perfPct);

    document.getElementById('oee-val-qual').innerText = `${formatPtNumber(qualPct)}%`;
    document.getElementById('oee-sub-qual').innerText = `${totalPecasBoas.toLocaleString('pt-BR')} boas / ${totalPecasProduzidas.toLocaleString('pt-BR')} produzidas · ${totalRefugo.toLocaleString('pt-BR')} refugos`;
    aplicarCorCardOEE('card-oee-qual', 'oee-val-qual', qualPct);

    let conceitoOEE = "Crítico";
    if (oeePct >= 85) conceitoOEE = "Excelente";
    else if (oeePct >= 65) conceitoOEE = "Bom";
    else if (oeePct >= 50) conceitoOEE = "Regular";

    document.getElementById('oee-val-geral').innerText = `${formatPtNumber(oeePct)}%`;
    document.getElementById('oee-sub-geral').innerText = `${conceitoOEE} · Calculado para o filtro atual`;
    aplicarCorCardOEE('card-oee-geral', 'oee-val-geral', oeePct);

    // Atualiza KPIs de Horas
    const hParadas = Math.floor(totalMinutosParados / 60);
    const mParadas = totalMinutosParados % 60;
    if (document.getElementById('dash-card-parado')) {
        document.getElementById('dash-card-parado').innerText = `${hParadas}h ${mParadas}m`;
    }

    const hProd = Math.floor(totalMinutosProdutivos / 60);
    const mProd = totalMinutosProdutivos % 60;
    if (document.getElementById('dash-card-utilizado')) {
        document.getElementById('dash-card-utilizado').innerText = `${hProd}h ${mProd}m`;
    }

    if (document.getElementById('dash-card-disp-prog')) {
        document.getElementById('dash-card-disp-prog').innerText = `${formatPtNumber(baseHorasDisponiveis)}h`;
    }

    const pctAproveitamento = baseHorasDisponiveis > 0 ? Math.round((horasProdutivas / baseHorasDisponiveis) * 100) : 0;
    if (document.getElementById('dash-txt-aproveitamento')) {
        document.getElementById('dash-txt-aproveitamento').innerText = `${pctAproveitamento}%`;
    }

    // Gráficos
    if (instChartBalanço) instChartBalanço.destroy();
    if (instChartIndices) instChartIndices.destroy();
    if (instChartPareto) instChartPareto.destroy();

    const ctxBalançoEl = document.getElementById('chartBalançoCarga');
    if (ctxBalançoEl) {
        instChartBalanço = new Chart(ctxBalançoEl.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Horas do Período'],
                datasets: [
                    { label: 'Disponíveis (Programadas)', data: [Number(baseHorasDisponiveis.toFixed(1))], backgroundColor: '#e2e8f0', barThickness: 26 },
                    { label: 'Produtivas (Utilizadas)', data: [Number(horasProdutivas.toFixed(1))], backgroundColor: '#16a34a', barThickness: 26 }
                ]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { beginAtZero: true } } }
        });
    }

    const ctxIndicesEl = document.getElementById('chartIndicesOEE');
    if (ctxIndicesEl) {
        instChartIndices = new Chart(ctxIndicesEl.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Disponibilidade', 'Performance', 'Qualidade', 'OEE Geral'],
                datasets: [{
                    label: 'Percentual (%)',
                    data: [dispPct, perfPct, qualPct, oeePct],
                    backgroundColor: ['#3b82f6', '#f59e0b', '#10b981', '#16a34a'],
                    borderRadius: 6
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { max: 110, beginAtZero: true } } }
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

    // Detalhamento Operadores/Paradas
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
            escopoOEE.forEach(rec => {
                let opNome = rec.nomeOperador || rec.criadoPor || "Operador Não Identificado";
                if (Array.isArray(rec.paradasMapeadas) && rec.paradasMapeadas.length > 0) {
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
                boxOperadores.innerHTML = `<div><b style="font-size:0.85rem; color:#1e293b; display:block; margin-bottom:8px;">Detalhamento da Máquina ${maqSelecionadaDash}:</b>${listaDetalhadaHTML.join('')}</div>`;
            } else {
                boxOperadores.innerHTML = `<div style="padding:10px; background:#f0fdf4; border-radius:8px; border:1px solid #bbf7d0; text-align:center;"><span style="color:#166534; font-weight:bold; font-size:0.85rem;">Nenhuma parada registrada para a máquina ${maqSelecionadaDash} no período.</span></div>`;
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
        const [ano, mes, dia] = String(d).split('-');
        opt.textContent = `${dia}/${mes}/${ano}`;
        selectData.appendChild(opt);
    });

    selectData.value = valorAnterior;
}

// Inicialização Global
window.addEventListener('DOMContentLoaded', () => {
    verifyInitialSetupSystem();
    setTodayOnDateField();
    buildDowntimeCheckboxesUI();

    const inputProduto = document.getElementById('form-prod');
    if (inputProduto) {
        inputProduto.addEventListener('change', (e) => buscarEPreencherProduto(e.target.value, "apontamento"));
        inputProduto.addEventListener('blur', (e) => buscarEPreencherProduto(e.target.value, "apontamento"));
    }

    const inputProgCod = document.getElementById('prog-cod');
    if (inputProgCod) {
        inputProgCod.addEventListener('input', (e) => buscarEPreencherProduto(e.target.value, "programacao"));
        inputProgCod.addEventListener('change', (e) => buscarEPreencherProduto(e.target.value, "programacao"));
        inputProgCod.addEventListener('blur', (e) => buscarEPreencherProduto(e.target.value, "programacao"));
    }

    ['prog-qtd', 'prog-horas-disp'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', atualizarEstimativaHorasCiclo);
            el.addEventListener('change', atualizarEstimativaHorasCiclo);
        }
    });

    const inputOp = document.getElementById('form-op');
    if (inputOp) {
        inputOp.addEventListener('input', aoSelecionarOuDigitarOP);
        inputOp.addEventListener('change', aoSelecionarOuDigitarOP);
    }

    const selectMaqForm = document.getElementById('form-maq');
    if (selectMaqForm) {
        selectMaqForm.addEventListener('change', atualizarDatalistOpsProgramadas);
    }

    // Listeners dos filtros por coluna da tabela de Programação
    [
        'f-prog-data', 'f-prog-inj', 'f-prog-op', 'f-prog-lote',
        'f-prog-cod', 'f-prog-desc', 'f-prog-hdisp', 'f-prog-hest',
        'f-prog-qtd', 'f-prog-prod', 'f-prog-falt', 'f-prog-status'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', renderProgramacaoTable);
            el.addEventListener('change', renderProgramacaoTable);
        }
    });

    const selectMes = document.getElementById('dash-select-mes');
    if (selectMes) {
        selectMes.value = String(new Date().getMonth() + 1);
    }
});
