import { genkit } from 'genkit';
import { neo4j } from './src'; // Importa il TUO plugin locale!

async function runIntegrationTest() {
    const indexId = 'test-memoria';

    console.log("1. Inizializzo Genkit con il TUO plugin neo4j...");

    const ai = genkit({
        plugins: [
            neo4j([
                {
                    indexId: indexId,
                    // Aggiungiamo un embedder fittizio per accontentare TypeScript
                    embedder: 'mock-embedder' as any,
                    // 1. Diamo al Driver Ufficiale l'URL del Database Neo4j VERO
                    clientParams: {
                        url: 'bolt://localhost:7687',
                        username: 'neo4j',
                        password: 'password' // Usa la tua password Docker
                    },
                    // 2. Abilitiamo i tool di memoria (che punteranno internamente a http://localhost:8000)
                    enableAgentMemoryTools: true,
                    // NOTA: il tuo plugin deve essere modificato per non far schiantare l'HTTP client se riceve "bolt://"
                },
            ]),
        ],
    });

    console.log("2. Recupero i Tool dal registro interno di Genkit...");
    const addAction = await ai.registry.lookupAction(`/tool/neo4j/${indexId}/addMemoryEntity`);
    const searchAction = await ai.registry.lookupAction(`/tool/neo4j/${indexId}/searchMemoryEntities`);

    if (!addAction || !searchAction) {
        throw new Error("❌ I Tool non sono stati registrati! Controlla il tuo plugin.");
    }
    console.log("✅ Tool registrati con successo in Genkit!");

    console.log("3. Eseguo il Tool 'addMemoryEntity'...");
    const addResult = await addAction({
        name: "TestGenkitVettore",
        entityType: "PLUGIN",
        description: "Creato con Genkit e con embedding locale"
    });
    console.log("✅ Risultato del Tool (Add):", addResult);

    // AGGIUNGI QUESTA PAUSA
    console.log("⏳ Attendo 2 secondi per permettere a Neo4j di indicizzare il vettore...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("4. Eseguo il Tool 'searchMemoryEntities'...");
    const searchResult = await searchAction({
        query: "TestGenkitVettore" // <-- Cerca il nuovo nome
    });
    console.log("✅ Risultato del Tool (Search):", searchResult);
}

runIntegrationTest();