/* Source fleet reconciliation. Counts printed vehicle classes; never decodes a
 * VIN, infers weight from cost/model, or assumes an unstated operating radius. */
(function(root){
  'use strict';
  const fields = {
    fleet_private_passenger:'Private Passenger', fleet_light:'Light', fleet_medium:'Medium',
    fleet_heavy_local:'Heavy (Local)', fleet_heavy_other:'Heavy (Other than Local)',
    fleet_extra_heavy_local:'Extra Heavy (Local)', fleet_extra_heavy_intermediate:'Extra Heavy (Intermediate)',
    fleet_extra_heavy_long:'Extra Heavy (Long Haul)', fleet_truck_tractors_local:'Truck Tractors (Local)',
    fleet_truck_tractors_intermediate:'Truck Tractor (Intermediate)', fleet_truck_tractors_long:'Truck Tractors (Long Haul)'
  };
  const scheduleHeading = /ITEM\s+THREE\s*[-–]\s*SCHEDULE\s+OF\s+COVER(?:AGE|ED)\s+AUTOS\s+YOU\s+OWN/i;
  const norm = value => String(value || '').replace(/\s+/g,' ').trim();
  const blocked = reason => ({blocked:true,reason});
  const validIdentifier = value => /^[A-HJ-NPR-Z0-9]{16,17}$/.test(value || '') && /\d/.test(value) && !/^([A-Z0-9])\1+$/.test(value);
  function excluded(record, strict){
    return !!record && (record.excluded === true || record.rejected === true || record.refused === true || record.gateDetails?.proceed === false ||
      /^(?:excluded|rejected|refused)$/i.test(record.status || record.outcome || '') ||
      (strict && /mismatch|no_match/i.test(record.applicantGate || record.applicant_match || '')));
  }
  function fieldFor(size,radius){
    if(size === 'PRIVATE PASSENGER') return 'fleet_private_passenger';
    if(size === 'LIGHT') return 'fleet_light';
    if(size === 'MEDIUM') return 'fleet_medium';
    if(size === 'TRAILER' || size === 'SEMI-TRAILER') return 'trailer';
    const suffix = {LOCAL:'local',INTERMEDIATE:'intermediate','LONG DISTANCE':'long','LONG HAUL':'long'}[radius];
    if(!suffix) return null;
    if(size === 'HEAVY') return suffix === 'local' ? 'fleet_heavy_local' : 'fleet_heavy_other';
    if(size === 'EXTRA HEAVY' || size === 'EXTRA HVY TRUCK') return 'fleet_extra_heavy_' + suffix;
    if(/^(?:TRK-TRACTOR|TRUCK TRACTOR|EX HVY TRK-TRACT)$/.test(size)) return 'fleet_truck_tractors_' + suffix;
    return null;
  }
  function parsePage(text,page){
    const vehicleHeader = /AUTO\s+YEAR\s+MAKE\s+MODEL\s+VEHICLE\s+ID\s+NO\.?\s+COST\s+NEW\s+PLACE\s+OF\s+GARAGING/i.exec(text);
    const typeHeader = /AUTO\s+RADIUS\s+BUSINESS\s+USE\s+TRUCK\s+SIZE\s+AGE\s+LOSS\s+PAYEE/i.exec(text);
    const end = /The following coverages and premiums apply to the above described covered autos\./i.exec(text);
    if(!vehicleHeader || !typeHeader || !end || vehicleHeader.index >= typeHeader.index || typeHeader.index >= end.index) return null;
    const vehicles = text.slice(vehicleHeader.index + vehicleHeader[0].length,typeHeader.index).trim();
    const types = text.slice(typeHeader.index + typeHeader[0].length,end.index).trim();
    // The printed identifier is retained verbatim. Some source schedules have
    // a 16-character identifier; this is a column anchor, not VIN validation.
    const vehicleRows = [...vehicles.matchAll(/(?:^|\s)(\d{1,6})\s+((?:19|20)\d{2})\s+([^]*?)\b([A-HJ-NPR-Z0-9]{16,17})\b/g)];
    if(!vehicleRows.length || vehicleRows[0].index !== 0 || [...vehicles.matchAll(/\b[A-HJ-NPR-Z0-9]{16,17}\b/g)].length !== vehicleRows.length) return null;
    const units = new Map();
    for(const row of vehicleRows){
      if(units.has(row[1]) || !validIdentifier(row[4]) || !row[3].trim() || /\b\d{1,6}\s+(?:19|20)\d{2}\b/.test(row[3])) return null;
      units.set(row[1],{unit:row[1],identifier:row[4],page});
    }
    // Parse the entire type table. Unknown rows/extra text are a miss, never
    // silently skipped. Match TRK-TRACT before the EXTRA HVY business-use text.
    const rows = types.split(/\s+(?=\d{1,6}\s+(?:LOCAL|INTERMEDIATE|LONG DISTANCE|LONG HAUL)\b)/);
    if(rows.length !== units.size) return null;
    const seen = new Set();
    for(const row of rows){
      const match = /^(\d{1,6})\s+(LOCAL|INTERMEDIATE|LONG DISTANCE|LONG HAUL)\s+(COMMERCIAL|EXTRA HVY TRUCK)\s+(EX HVY TRK-TRACT|TRK-TRACTOR|TRUCK TRACTOR|EXTRA HEAVY|EXTRA HVY TRUCK|PRIVATE PASSENGER|SEMI-TRAILER|TRAILER|LIGHT|MEDIUM|HEAVY)\s+\d{1,2}$/.exec(row);
      if(!match || !units.has(match[1]) || seen.has(match[1])) return null;
      const field = fieldFor(match[4],match[2]);if(!field) return null;
      seen.add(match[1]);Object.assign(units.get(match[1]),{field,radius:match[2],size:match[4]});
    }
    // The coverage grid repeats the unit identifiers independently. Require
    // that exact sequence too, so an omitted vehicle row cannot lower totals.
    const grid = /VEHICLE\s+NUMBER\(S\)\s*-*\s+([\d\s]+?)\s+LIABILITY\b/i.exec(text.slice(end.index));
    if(!grid || grid[1].trim().split(/\s+/).join(',') !== [...units.keys()].join(',')) return null;
    return [...units.values()];
  }
  function parseFile(file){
    const pages = file?.extractMeta?.pageTexts || file?.pageTexts;
    const count = file?.extractMeta?.pageCount;
    if(!Array.isArray(pages) || !Number.isInteger(count) || count !== pages.length || !Array.from(pages).every(x=>typeof x==='string')) return blocked('complete_fleet_source_pages_unavailable');
    const indices = pages.flatMap((text,i)=>scheduleHeading.test(text)?[i]:[]);
    if(!indices.length) return null;
    // Bounded by other full-document pages. Cropped/open-ended schedules and
    // discontinuous schedule ranges need source review rather than a total.
    if(indices[0] === 0 || indices.at(-1) === pages.length-1 || indices.some((n,i)=>n !== indices[0]+i) ||
       !/\bDECLARATIONS\b/i.test(pages[indices[0]-1]) || !/\bDECLARATIONS\b/i.test(pages[indices.at(-1)+1])) return blocked('fleet_schedule_boundaries_incomplete');
    let quote = null;const units = [],ids = new Set(),identifiers = new Set();
    for(const i of indices){
      const text = norm(pages[i]),q = /\bQuote\s+Number\s*:\s*([A-Z0-9-]+)\s+Account\s+Number\s*:/i.exec(text);
      if(!q || (quote && quote !== q[1])) return blocked('fleet_schedule_quote_identity_conflict');
      quote = q[1];const rows = parsePage(text,i+1);
      if(!rows) return blocked('fleet_schedule_rows_incomplete_or_ambiguous');
      for(const row of rows){
        if(ids.has(row.unit) || identifiers.has(row.identifier)) return blocked('fleet_schedule_duplicate_vehicle_identity');
        ids.add(row.unit);identifiers.add(row.identifier);units.push(row);
      }
    }
    const counts = Object.fromEntries(Object.keys(fields).map(field=>[field,0]));
    for(const row of units) if(row.field !== 'trailer') counts[row.field]++;
    return {version:1,complete:true,sourceFileId:file.id,sourceFileName:file.name,submissionId:file.submissionId || null,quoteNumber:quote,
      pages:indices.map(i=>i+1),units,counts,total:Object.values(counts).reduce((a,b)=>a+b,0)};
  }
  function fromSubmission(submission,{files,record,strict=false,matched=false}={}){
    record = record || submission?.snapshot?.extractions?.al_quote || submission?.extractions?.al_quote;
    if(!record) return null;
    if(excluded(record,strict)) return blocked('fleet_source_excluded');
    files = files || submission?.snapshot?.files || [];
    const sid = submission?.id || submission?.submission_id || null;
    const sourceIds = Array.isArray(record.sourceFileIds95) ? record.sourceFileIds95 : null;
    const candidates = files.filter(file=>{
      if(!file?.id || !file.name || excluded(file,strict) || (file.submissionId && file.submissionId !== sid)) return false;
      if(matched) return true; // exact files supplied by the module dispatcher
      if(sourceIds) return sourceIds.includes(file.id);
      const routes = [file.routedTo,...(Array.isArray(file.routedToAll)?file.routedToAll:[])];
      return routes.includes('al_quote') && (record.sourceInfo === file.name || String(record.sourceInfo||'').split(', ').includes(file.name));
    });
    if(!candidates.length){
      // Lightweight Workbench hydration can omit files temporarily. A saved
      // reconciliation is usable only with its own explicit source binding.
      const saved=record.fleet_source95;
      if(!files.length && saved?.complete && sourceIds?.includes(saved.sourceFileId) && (!saved.submissionId || saved.submissionId===sid) && validRoster(saved)) return saved;
      return null;
    }
    if(!sourceIds && !matched && new Set(candidates.map(f=>f.name)).size !== candidates.length) return blocked('fleet_source_filename_ambiguous');
    const rosters = candidates.map(parseFile).filter(Boolean);
    if(rosters.some(r=>r.blocked)) return blocked('fleet_source_schedule_requires_review');
    // Do not merge vehicle lists across quotes, even if their counts happen
    // to agree. One unambiguous original quote must own the authoritative list.
    if(rosters.length > 1) return blocked('multiple_fleet_source_quotes');
    return rosters[0] || null;
  }
  function validRoster(roster){
    if(roster?.version!==1 || !roster.complete || typeof roster.sourceFileId!=='string' || !Array.isArray(roster.units) || !roster.units.length || !Array.isArray(roster.pages) || !roster.pages.length) return false;
    const counts=Object.fromEntries(Object.keys(fields).map(field=>[field,0])),ids=new Set(),identifiers=new Set();
    for(const row of roster.units){
      if(!row || !/^\d{1,6}$/.test(row.unit) || !validIdentifier(row.identifier) || ids.has(row.unit) || identifiers.has(row.identifier) || !roster.pages.includes(row.page) || fieldFor(row.size,row.radius)!==row.field) return false;
      ids.add(row.unit);identifiers.add(row.identifier);if(row.field!=='trailer') counts[row.field]++;
    }
    return Object.keys(fields).every(field=>Number.isInteger(roster.counts?.[field]) && roster.counts[field]===counts[field]) && roster.total===Object.values(counts).reduce((a,b)=>a+b,0);
  }
  function rosterText(roster){
    if(!roster?.complete) return '';
    return '**Fleet Composition (source-reconciled):**\n' + Object.entries(fields).map(([field,label])=>{
      const units=roster.units.filter(row=>row.field===field).map(row=>row.unit);
      return '- '+label+': '+roster.counts[field]+(units.length?' (units '+units.join(', ')+')':'');
    }).join('\n')+'\n- Total power units: '+roster.total+'\n- Vehicle code evidence: printed TRUCK SIZE and AUTO RADIUS rows, matched to vehicle identifiers in the original quote, pages '+roster.pages.join(', ')+'.';
  }
  function reconcileText(text,roster){
    if(!roster?.complete) return String(text || '');
    let inserted=false,inFleet=false;const retained=[];
    const labelPattern = Object.values(fields).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
    const countLine = new RegExp('^(?:'+labelPattern+'|Total(?: power)? units|Vehicle code evidence)\\s*:', 'i');
    for(const line of String(text||'').split(/\r?\n/)){
      const plain=line.replace(/^\s*(?:[-*]\s+|#{1,6}\s*)?/,'').replace(/\*\*/g,'').trim();
      if(/^(?:Corrected\s+)?Fleet Composition(?:\s*\([^)]*\))?\s*:?$/i.test(plain)){
        inFleet=true;if(!inserted){retained.push(rosterText(roster));inserted=true;}continue;
      }
      if(inFleet){
        if(countLine.test(plain)) continue;
        if(/^(?:Let me recount carefully\s*:|Note:\s*["“]?(?:Heavy|Light|Medium|Truck).*(?:Correcting|recount)|Heavy units\s*\(TRUCK SIZE|Truck[- ]Tractor\s*\/\s*EX HVY|Total:\s*\d+(?:\s*\+\s*\d+)+\s*=)/i.test(plain)) continue;
        if((/^(?:\*\*[^*]+\*\*|#{1,6}\s+)/.test(line.trim()) && plain.endsWith(':')) || /^[A-Za-z][A-Za-z /&-]{1,60}:$/.test(plain)) inFleet=false;
      }
      retained.push(line);
    }
    if(!inserted) retained.push('',rosterText(roster));
    let result = retained.join('\n').replace(/\n{3,}/g,'\n\n').trim();
    // Only explicit fleet field names are canonicalized in machine output.
    // Nested objects/arrays may describe another insured, policy or scenario;
    // their ownership is not established by this one-source roster. Every
    // unrelated term/value and the original response
    // remain available; the pipeline archives the pre-reconciliation text.
    result = result.replace(/```json([^\n]*)\n([^]*?)\n```/g,(block,schema,body)=>{
      let data;try{data=JSON.parse(body);}catch(_){return block;}let changed=false;
      function visit(value){
        if(!value || typeof value!=='object' || Array.isArray(value)) return;
        for(const key of Object.keys(value)){
          const aliases={fleet_heavy:'fleet_heavy_local',fleet_extra_heavy:'fleet_extra_heavy_local',fleet_truck_tractors:'fleet_truck_tractors_local'};
          const field=aliases[key] || key;
          const count=Object.prototype.hasOwnProperty.call(fields,field)?roster.counts[field]:key==='total_power_units'?roster.total:null;
          if(count!==null && (value[key]===null || typeof value[key]==='number' || typeof value[key]==='string')){
            const next=typeof value[key]==='string'?String(count):count;if(value[key]!==next){value[key]=next;changed=true;}
          }
        }
      }
      visit(data);return changed?'```json'+schema+'\n'+JSON.stringify(data,null,2)+'\n```':block;
    });
    return result;
  }
  root.STMFleetSource = {fields,parseFile,fromSubmission,rosterText,reconcileText,validRoster};
})(typeof window !== 'undefined' ? window : globalThis);
