from fastapi import FastAPI, Request
from neo4j_agent_memory import MemoryClient, MemorySettings, Neo4jConfig
from neo4j_agent_memory.config.settings import ExtractionConfig, ExtractorType, MergeStrategy
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from neo4j_agent_memory import MemoryClient, MemorySettings, Neo4jConfig
from neo4j_agent_memory.config.settings import ExtractionConfig, ExtractorType, MergeStrategy

app = FastAPI()

# 1. CONFIGURAZIONE "BLINDATA" DEL SERVER
settings = MemorySettings(
    neo4j=Neo4jConfig(
        uri="bolt://localhost:7687",
        username="neo4j",
        password="apoc1234"  # Assicurati che corrisponda al tuo DB
    ),
    # Modello di Embedding LOCALE a 384 dimensioni
    embedding={
        "provider": "sentence_transformers",
        "model": "all-MiniLM-L6-v2",
        "dimensions": 384
    },
    # 2. CONFIGURAZIONE NER LOCALE (ZERO API, ZERO LLM)
    extraction=ExtractionConfig(
        extractor_type=ExtractorType.PIPELINE,
        enable_spacy=True,          # Usa spaCy (modello statistico ultraveloce)
        enable_gliner=True,         # Usa GLiNER (modello neurale locale)
        enable_llm_fallback=False,  # <-- FONDAMENTALE: Spegne le API esterne
        merge_strategy=MergeStrategy.CONFIDENCE,
        entity_types=["PERSON", "ORGANIZATION", "LOCATION", "MOVIE", "CHARACTER"]
    )
)

memory_client = MemoryClient(settings)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Eseguito all'avvio del server
    print("Connessione a Neo4j in corso...")
    await memory_client.connect()
    yield
    # Eseguito allo spegnimento del server (Ctrl+C)
    print("Chiusura connessione Neo4j...")
    await memory_client.close()

# MODIFICA LA CREAZIONE DELL'APP:
app = FastAPI(lifespan=lifespan)

@app.post("/add_entity")
async def add_entity(request: Request):
    """Usato quando Genkit/Gemini fa il NER e passa i dati esatti"""
    data = await request.json()
    name = data.get("name")
    entity_type = data.get("entityType")
    description = data.get("description")
    
    entity, _ = await memory_client.long_term.add_entity(
        name,
        entity_type,
        {"description": description} if description else None
    )
    return {"success": True, "id": entity.id}

@app.post("/add_relationship")
async def add_relationship(request: Request):
    """Usato quando Genkit/Gemini capisce le relazioni e le passa al server"""
    data = await request.json()
    source = data.get("source") or data.get("sourceId")
    target = data.get("target") or data.get("targetId")
    rel_type = data.get("type") or data.get("relationshipType")
    description = data.get("description")
    
    # Risolto l'errore del TypeError usando gli argomenti posizionali
    await memory_client.long_term.add_relationship(
        source,
        target,
        rel_type,
        description
    )
    return {"success": True}

@app.post("/search_entities")
async def search_entities(request: Request):
    data = await request.json()
    query = data.get("query")
    results = await memory_client.long_term.search_entities(query)
    
    return [
        {"id": r.id, "name": r.name, "description": r.description} 
        for r in results
    ]

# --- NUOVA ROTTA PER IL NER LOCALE ---
@app.post("/extract_and_save")
async def extract_and_save(request: Request):
    """
    Invia un testo grezzo qui. Python userà spaCy e GLiNER 
    per trovare entità e salvarle in Neo4j, senza usare Gemini!
    """
    data = await request.json()
    text = data.get("text")
    
    # La libreria Python analizzerà il testo con i modelli locali
    result = await memory_client.long_term.extract_and_save(text)
    
    return {"success": True, "entities_found": len(result)}