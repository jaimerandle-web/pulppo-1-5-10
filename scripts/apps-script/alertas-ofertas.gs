// =========================================================================
// ALERTAS DE OFERTAS 1·5·10 → GOOGLE CHAT
// =========================================================================
// Archivo NUEVO dentro del mismo proyecto de Apps Script del bot del formulario (Extensiones →
// Apps Script → "+" → Script → pegar esto). Reusa WEBHOOK_URL del script del formulario: mismo grupo.
//
// Cada 15 min pregunta al tool 1·5·10 (Vercel, lee Mongo) qué ofertas de propiedades 1·5·10
// fueron aceptadas, se cerraron o se cayeron, y avisa en el Chat SÓLO lo que no esté ya en la
// pestaña "Log ofertas". La pestaña es la memoria: si borras una fila, ese aviso se vuelve a mandar.
//
// Configuración (una sola vez):
//   1. Configuración del proyecto (⚙️) → Propiedades de la secuencia de comandos →
//      ALERTAS_TOKEN = <el mismo valor que en Vercel>
//   2. Ejecutar instalarTriggerOfertas() una vez y aceptar permisos.
//      La primera corrida llena el log con lo de los últimos días SIN avisar (para no spamear el grupo).
// =========================================================================

const ALERTAS_API = "https://pulppo-inmobiliarias.vercel.app/api/alertas/ofertas?horas=72";
const LOG_SHEET_NAME = "Log ofertas";
const LOG_HEADERS = [
  "Clave", "Tipo", "Fecha del cambio", "Código", "Inmobiliaria", "KAM", "Monto",
  "Precio publicado", "Vende", "Trae comprador", "Liga", "Registrado", "Estado"
];
const TIPO_LABEL = { aceptada: "Oferta aceptada", cerrada: "Cierre", caida: "Oferta caída" };

/**
 * Trigger cada 15 min: busca alertas nuevas, avisa al Chat y las registra en el log.
 */
function revisarOfertas1510() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return; // otra corrida sigue en curso
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(LOG_SHEET_NAME);
    const primeraVez = !sheet;
    if (primeraVez) {
      sheet = ss.insertSheet(LOG_SHEET_NAME);
      sheet.appendRow(LOG_HEADERS);
      sheet.setFrozenRows(1);
    }

    const alertas = pedirAlertas();
    if (!alertas) return;

    const yaAvisadas = new Set(
      sheet.getLastRow() > 1
        ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(r => String(r[0]))
        : []
    );

    alertas.forEach(a => {
      if (yaAvisadas.has(a.clave)) return;
      let estado = "Histórico (no avisado)";
      if (!primeraVez) estado = mandarAlChat(a.texto) ? "Avisado" : "Error al avisar";
      // si falló el envío no se registra: la siguiente corrida lo reintenta
      if (estado === "Error al avisar") return;
      sheet.appendRow([
        a.clave, TIPO_LABEL[a.tipo] || a.tipo, new Date(a.fecha), a.codigo, a.inmobiliaria, a.kam,
        a.monto, a.precio_publicado, a.broker_vende, a.broker_comprador, a.url, new Date(), estado
      ]);
    });
  } catch (error) {
    Logger.log("Error en revisarOfertas1510: " + error.toString());
  } finally {
    lock.releaseLock();
  }
}

function pedirAlertas() {
  const token = PropertiesService.getScriptProperties().getProperty("ALERTAS_TOKEN");
  if (!token) {
    Logger.log("Falta ALERTAS_TOKEN en las propiedades del script.");
    return null;
  }
  const res = UrlFetchApp.fetch(ALERTAS_API, {
    method: "get",
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log("API de alertas respondió " + res.getResponseCode() + ": " + res.getContentText().slice(0, 300));
    return null;
  }
  return JSON.parse(res.getContentText()).alertas || [];
}

function mandarAlChat(texto) {
  try {
    const res = UrlFetchApp.fetch(WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ text: texto }),
      muteHttpExceptions: true
    });
    return res.getResponseCode() === 200;
  } catch (error) {
    Logger.log("Error al enviar a Google Chat: " + error.toString());
    return false;
  }
}

/**
 * Ejecutar UNA vez a mano: crea el trigger cada 15 min (borra uno previo si existe) y hace la
 * primera corrida, que llena el log sin avisar.
 */
function instalarTriggerOfertas() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "revisarOfertas1510")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("revisarOfertas1510").timeBased().everyMinutes(15).create();
  revisarOfertas1510();
}
