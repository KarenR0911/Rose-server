const express = require("express");
const axios = require("axios");
const readline = require("readline");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const HF_TOKEN = process.env.HF_TOKEN;
const MAX_HISTORY = 2;

let hayNuevaRespuesta = false;
let ultimaConexionHardware = 0;
let appActiva = false; // Rastrea si el usuario tiene la app abierta
let ultimaPeticionApp = 0;

const SYSTEM_PROMPT = `
Eres GIA, una asistente educativa y amigable para niños.

Reglas:
- Nunca generes contenido sexual, violento o inapropiado.
- Si el usuario pide algo inapropiado, recházalo amablemente y sugiere un tema educativo o divertido.
- Sé sincera incluso si debes contradecir al usuario.
- Responde solo en texto plano.
- No uses markdown.
- No uses emojis.
- Habla de forma natural y conversacional.
- Da respuestas breves y claras, pero si es necesario explicar más, hazlo.
- No te extiendas a más de 180 caracteres.
`;

let memoria = {
    nombre: null,
    gustos: []
};

let historial = [];

function cargarDatos() {
    try {
        if (fs.existsSync("memory.json")) {
            const data = fs.readFileSync("memory.json", "utf8");
            const datos = JSON.parse(data);
            historial = datos.historial || [];
            memoria = datos.memoria || { nombre: null, gustos: []};
        }
    } catch (error) {
        console.error("Error cargando memoria:", error.message);
    }
}

function guardarDatos(){
    try {
        const datos = {historial: historial.slice(-10), memoria};
        fs.writeFileSync("memory.json", JSON.stringify(datos, null, 2));
    }
    catch (error) {
        console.error('Error guardando memoria:', error.message)
    }
}

function construirSystemPrompt() {
    return `
${SYSTEM_PROMPT}

Memoria del usuario:
- Nombre: ${memoria.nombre || "desconocido"}
- Gustos: ${memoria.gustos.length > 0 ? memoria.gustos.join(", ") : "desconocidos"}`;
}

function limpiarTexto(texto) {
    if (!texto) return "";
    return texto
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .replace(/#{1,6}/g, "")
        .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
        .replace(/[\u{2600}-\u{26FF}]/gu, "")
        .replace(/\n{2,}/g, "\n")
        .trim();
}

function actualizarMemoria(texto) {
    const textoLower = texto.toLowerCase();
    const matchNombre = texto.match(/me llamo\s+([a-zA-ZáéíóúñÑ]+)/i);

    if (matchNombre) {
        memoria.nombre = matchNombre[1];
    }

    const temas = ["robots", "electrónica", "programación","videojuegos", "ia", "música", "ciencia"
    ];
    temas.forEach((tema) => {
        if (
            textoLower.includes(tema) &&
            !memoria.gustos.includes(tema)
        ) {
            memoria.gustos.push(tema);
        }
    });
}

function recortarHistorial() {
    if (historial.length > MAX_HISTORY * 2) {
        historial = historial.slice(-(MAX_HISTORY * 2));
    }
}

function limitarTextoTTS(texto) {
  return texto.length > 180 ? texto.slice(0, 180) : texto;
}

async function preguntarIA(texto) {
    try {
        actualizarMemoria(texto);
        historial.push({
            role: "user",
            content: texto
        });
        recortarHistorial();
        guardarDatos();

        const messages = [
            {
                role: "system",
                content: construirSystemPrompt()
            },
            ...historial
        ];

        const respuestaHF = await axios.post(
            "https://router.huggingface.co/v1/chat/completions",
            {
                model: "Qwen/Qwen3-235B-A22B-Instruct-2507:together",
                messages,
                max_tokens: 200,
                temperature: 0.6,
                repetition_penalty: 1.1
            },
            {
                headers: {
                    Authorization: `Bearer ${HF_TOKEN}`,
                    "Content-Type": "application/json"
                },
                timeout: 30000
            }
        );
        

        const respuestaRaw =
    respuestaHF?.data?.choices?.[0]?.message?.content
    || "No pude generar respuesta.";

        const respuesta = limpiarTexto(respuestaRaw);

        historial.push({
            role: "assistant",
            content: respuesta
        });
        guardarDatos();
        recortarHistorial();
        return respuesta;
    } catch (error) {
        console.error("\n❌ ERROR IA:");
        if (error.response) {
            console.error(error.response.data);
        } else {
            console.error(error.message);
        }
        return "Lo siento, tuve un problema procesando eso.";
    }
}

async function generarTTS(texto, fileName = "voz.mp3") {
    texto = limitarTextoTTS(texto);
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(texto)}&tl=es&client=tw-ob`;

        const response = await axios.get(url, {
            responseType: "arraybuffer"
        });
        fs.writeFileSync("voz.mp3", response.data);
        const filePath = path.join(__dirname, fileName);
        fs.writeFileSync(filePath, response.data);
        return filePath;
    } catch (err) {
        console.log("❌ Error TTS:", err.message);
        return null;
    }
}
/*
async function enviarAlESP32(usuario, respuesta) {
    try {
        const response = await axios.post(
            `http://${ESP32_IP}/chat`,
            {
                usuario,
                respuesta
            },
            {
                headers: {
                    "Content-Type": "application/json"
                },
                timeout: 5000
            }
        );
    } catch (error) {

        console.log(
            "❌ Error enviando al ESP32"
        );

        console.log(error.message);
    }
}

async function enviarAudioAlESP32(filePath) {
    try {
        const audio = fs.readFileSync(filePath);

        await axios.post(`http://${ESP32_IP}/audio`, audio, {
            headers: {
                "Content-Type": "application/octet-stream"
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        //console.log("📡 Audio enviado al ESP32");

    } catch (error) {
        console.log("❌ Error enviando audio:", error.message);
    }
}
*/
app.use("/voz.mp3", express.static(path.join(__dirname, "voz.mp3")));

// --- RUTA PARA EL ESP32: Avisar que sigue vivo y preguntar el ritmo ---
app.post("/hardware-heartbeat", (req, res) => {
    ultimaConexionHardware = Date.now();
    
    // 🚀 SISTEMA DE SEGURIDAD AUTO-APAGADO
    // Si 'appActiva' es true, pero han pasado más de 20 segundos sin que el teléfono 
    // procese texto o mande un latido de actividad, la apagamos a la fuerza.
    if (appActiva && (Date.now() - ultimaPeticionApp > 20000)) {
        appActiva = false;
        console.log("[🛡️ SEGURIDAD SERVER] La app se cerró de golpe o no responde. Desactivando ráfaga forzosamente.");
    }
    
    res.json({ 
        status: "alive", 
        modoRafaga: appActiva 
    });
});

// --- RUTA PARA LA APP: Avisar que el usuario abrió el chat ---
app.post("/app-activa", (req, res) => {
    appActiva = req.body.activa; // true o false
    if (appActiva) {
        ultimaPeticionApp = Date.now(); // Registramos el instante de actividad
    }
    console.log(`[APP] Cambió estado de actividad a: ${appActiva}`);
    res.json({ status: "ok", modoRafaga: appActiva });
});

// --- RUTA PARA LA APP: Doble verificación al abrir la app ---
app.get("/verificar-ecosistema", (req, res) => {
    const ahora = Date.now();
    // En reposo consideramos online si latió hace menos de 2.5 minutos (150000 ms)
    // En ráfaga, exigimos que haya latido hace menos de 6 segundos
    const margenAceptable = appActiva ? 6000 : 150000;
    const estaOnline = (ahora - ultimaConexionHardware) < margenAceptable;

    res.json({ 
        hardwareOnline: estaOnline 
    });
});

app.post("/procesar", async (req, res) => {
    ultimaPeticionApp = Date.now(); // Cada mensaje del niño cuenta como actividad en la app
    appActiva = true; 
    
    const textoRecibido = req.body.texto;
    if (!textoRecibido) {
        return res.status(400).json({ error: "Falta el texto" });
    }

    const respuesta = await preguntarIA(textoRecibido);
    const audioPath = await generarTTS(respuesta);

if (audioPath) {
    hayNuevaRespuesta = true;
    console.log("📡 Nueva respuesta generada, lista para enviar al ESP32");
}

    res.json({
        respuesta
    });
});

app.get("/status", (req, res) => {
    res.json({ 
        online: true, 
        message: "El servidor de GIA está despierto y listo." 
    });
});

app.get("/alerta-esp32", (req, res) => {
    const respuestaParaEnviar = hayNuevaRespuesta;
    hayNuevaRespuesta = false;
    res.json({
        nuevaRespuesta: respuestaParaEnviar
    });
});

cargarDatos();

app.listen(port, "0.0.0.0", () => {

    console.log("GIA iniciada");

});