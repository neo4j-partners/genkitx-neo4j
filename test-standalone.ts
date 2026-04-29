// NOTA: Non c'è nessun import di 'genkit' o del tuo plugin qui.
// Importiamo solo il client ufficiale di Neo4j Labs.

// @ts-ignore: Ignoriamo l'errore TS per questo test diretto
// import { MemoryClient } from '@neo4j-labs/src/client.ts';
import { MemoryClient } from '../agent-memory-tck/clients/typescript/src/index.ts';
// import { MemoryClient } from "@neo4j-labs/agent-memory";

async function runStandaloneTest() {
    console.log("1. Inizializzo il MemoryClient verso il server Python...");
    // Puntiamo al server Python che hai avviato con uvx
    const memoryClient = new MemoryClient({
        endpoint: "http://localhost:8000",
    });

    try {
        await memoryClient.connect();
        console.log("✅ Connesso al server Python con successo!");

        console.log("2. Aggiungo un'entità nella Long-Term Memory...");
        const entity = await memoryClient.longTerm.addEntity(
            "TestSoloAgentMemory",
            "CONCEPT",
            { description: "Creato usando solo il client TypeScript ufficiale" }
        );
        console.log(`✅ Entità creata! ID assegnato: ${entity.id}`);

        console.log("3. Eseguo una ricerca per verificare che sia sul database...");
        const results = await memoryClient.longTerm.searchEntities("TestSoloAgentMemory");

        console.log("✅ Risultati trovati:");
        results.forEach(res => {
            console.log(` - Nome: ${res.name} | Descrizione: ${res.description}`);
        });

    } catch (error) {
        console.error("❌ Errore durante il test:", error);
    } finally {
        console.log("4. Chiudo la connessione.");
        await memoryClient.close();
    }
}

runStandaloneTest();