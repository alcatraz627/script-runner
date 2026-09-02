
  # Versable Scripts — JEGS eBay Product Data Pipeline                            
                                                                                  
  **Purpose:** Transforms raw JEGS eBay Excel exports into enhanced, normalized   
  product data with LLM-generated content, attribute extraction, and poster image 
  generation. SvelteKit dashboard for pipeline management.                        
                                                                                  
  ## Tech Stack                                                                   
                                                                                  
  • **Backend:** Node.js 23.x (CommonJS) + Express 5.x, port 3460                 
  • **Frontend:** SvelteKit 2.x + Svelte 5.x + Tailwind CSS 4.x, port 5173        
  • **AI:** @anthropic-ai/sdk (Claude Haiku), batches of 20                       
  • **Data:** exceljs/xlsx, puppeteer for poster generation                       
  • **Server:** Single-file server.js (~1400 lines), in-memory queue (2 concurrent
  jobs max)                                                                       
                                                                                  
  ## Directory Structure                                                          
                                                                                  
    pipeline/           → Engine framework (engine.js, run.js, io.js, manifest.js,
  job-queue.js, logger.js)                                                        
    transforms/         → 18 processing steps (enhance-content, extract-attributes,
  clean-attributes, jegs-normalize, etc.)                                         
    runs/<run-id>/      → Per-run data (run.config.js, manifest.json, data/, logs/,
  posters/)                                                                       
    ui/                 → SvelteKit dashboard (9 pages, 12+ components, Svelte 5  
  runes)                                                                          
    preview-dashboard/  → Vanilla JS image viewer (port 3457)                     
    parse-excel/        → Legacy Excel parsing utilities                          
                                                                                  
  ## Pipeline Conventions                                                         
                                                                                  
  • **Config-driven:** each run has run.config.js defining input, step sequence,  
  outputs                                                                         
  • **Idempotent steps:** re-running skips if raw.json exists                     
  • **Data flow:** raw.json → step1.json → step2.json → final.json                
  • **CLI flags:** --step, --from, --limit, --slice                           
  • **Transform signature:** { meta, run(items, config, ctx) }                    
  • **JSDoc headers:** parsed by server for UI metadata                           
                                                                                  
  ## Critical Rules                                                               
                                                                                  
  1. **Test first:** Always sample 2–3 rows before full runs                      
  2. **Verify exports:** Read xlsx back; don't just check write succeeded         
  3. **Cell limit:** 32,767 chars max — truncate with [TRUNCATED] marker          
  4. **flattenArrayFields:** Corrupts arrays-of-objects (use spread, not .join()) 
  5. **Module cache:** engine.js clears cache before loading configs/transforms   
  6. **Sideload scripts:** Verify which fields are re-derived vs passed through   
  7. **Write tool:** Use for JS files — heredoc corrupts template literals in zsh 
                                                                                  
  ## Known Issues                                                                 
                                                                                  
  • **Poster download hang:** Server generates image but response never reaches   
  client (real payloads)                                                          
  • **Image gap:** 119 items lose images when Main Image is None — fallback to    
  pipe-separated images                                                           
                                                                                  
  ## Quick Start                                                                  
                                                                                  
    ./start-dev.sh              # Starts backend (3460) + frontend (5173)         
    cd ui && npm run check      # Type check                                      
                                                                                  
  **API docs:** Scalar OpenAPI 3.1 browser at backend root                        

