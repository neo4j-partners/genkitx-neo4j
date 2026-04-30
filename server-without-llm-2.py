from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from neo4j_agent_memory import MemoryClient, MemorySettings, Neo4jConfig
from neo4j_agent_memory.config.settings import ExtractionConfig, ExtractorType, MergeStrategy

# 1. ROBUST SERVER CONFIGURATION
settings = MemorySettings(
    neo4j=Neo4jConfig(
        uri="bolt://localhost:7687",
        username="neo4j",
        password="apoc1234"  # Ensure this matches your local Neo4j instance
    ),
    # Local Embedding Model (384 dimensions)
    embedding={
        "provider": "sentence_transformers",
        "model": "all-MiniLM-L6-v2",
        "dimensions": 384
    },
    # 2. LOCAL NER CONFIGURATION (NO EXTERNAL LLM API)
    extraction=ExtractionConfig(
        extractor_type=ExtractorType.PIPELINE,
        enable_spacy=True,          # Use spaCy for standard entities (PERSON, ORG, GPE)
        enable_gliner=True,         # Use GLiNER for custom zero-shot entities
        enable_llm_fallback=False,  # CRITICAL: Disables external API calls for extraction
        merge_strategy=MergeStrategy.CONFIDENCE,
        entity_types=["PERSON", "ORGANIZATION", "LOCATION", "MOVIE", "CHARACTER"]
    )
)

memory_client = MemoryClient(settings)

# 3. CONNECTION LIFECYCLE MANAGEMENT
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Connecting to Neo4j...")
    await memory_client.connect()
    yield
    print("Closing Neo4j connection...")
    await memory_client.close()

app = FastAPI(lifespan=lifespan)

# --- LONG-TERM MEMORY ENDPOINTS ---

@app.post("/add_entity")
async def add_entity(request: Request):
    """Called when the Genkit Agent extracts structured entity data via tool call."""
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
    """Called when the Genkit Agent connects two entities via tool call."""
    data = await request.json()
    source = data.get("source") or data.get("sourceId")
    target = data.get("target") or data.get("targetId")
    rel_type = data.get("type") or data.get("relationshipType")
    description = data.get("description")
    
    # Using positional arguments to avoid keyword mismatches with underlying library
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

@app.post("/extract_and_save")
async def extract_and_save(request: Request):
    """
    Endpoint for raw text ingestion.
    Python will use local NLP models (spaCy/GLiNER) to find entities and save them 
    into Neo4j, without invoking Gemini.
    """
    data = await request.json()
    text = data.get("text")
    
    # Analyze text with local models and save to graph
    result = await memory_client.long_term.extract_and_save(text)
    
    return {"success": True, "entities_found": len(result)}

# --- REASONING MEMORY ENDPOINTS (SILVER TIER) ---

@app.post("/start_trace")
async def start_trace(request: Request):
    data = await request.json()
    session_id = data.get("sessionId") or data.get("session_id")
    task = data.get("task")
    
    trace = await memory_client.reasoning.start_trace(session_id, task)
    return {"id": trace.id}

@app.post("/add_step")
async def add_step(request: Request):
    data = await request.json()
    trace_id = data.get("traceId") or data.get("trace_id")
    thought = data.get("thought")
    action = data.get("action")
    
    step = await memory_client.reasoning.add_step(
        trace_id=trace_id,
        thought=thought,
        action=action
    )
    return {"id": step.id}

@app.post("/complete_trace")
async def complete_trace(request: Request):
    data = await request.json()
    trace_id = data.get("traceId") or data.get("trace_id")
    outcome = data.get("outcome")
    success = data.get("success")
    
    await memory_client.reasoning.complete_trace(
        trace_id=trace_id,
        outcome=outcome,
        success=success
    )
    return {"success": True}