import { useState } from "react";
import { supabase } from "./supabaseClient";

const C = {
  blauw:"#1B3A6B", groen:"#4A9B3C", bg:"#f0f4f8",
  border:"#d1dbe8", text:"#1a2b47", muted:"#6b7a8d",
};

// ─── UPLOAD HELPER ────────────────────────────────────────────────────────────
export async function uploadBijlages(bestanden, map = "algemeen") {
  const urls = [];
  for (const b of bestanden) {
    const ext = b.bestand.name.split(".").pop();
    const pad = `${map}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("bijlages").upload(pad, b.bestand, { upsert: false });
    if (error) { console.error("Upload fout:", error); continue; }
    const { data } = supabase.storage.from("bijlages").getPublicUrl(pad);
    urls.push({ naam: b.naam, url: data.publicUrl, type: b.type });
  }
  return urls;
}

// ─── BIJLAGE UPLOADER COMPONENT ───────────────────────────────────────────────
export function BijlageUploader({ bestanden, setBestanden, label = "📎 Foto's of bijlages toevoegen" }) {
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(files) {
    const nieuw = Array.from(files).map(f => ({
      naam: f.name, type: f.type, grootte: f.size, bestand: f,
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
    }));
    setBestanden(prev => [...prev, ...nieuw]);
  }

  return (
    <div>
      <label style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:".8px",textTransform:"uppercase",marginBottom:6,display:"block"}}>
        {label}
      </label>
      <label style={{display:"block",cursor:"pointer"}}>
        <div onDragOver={e=>{e.preventDefault();setDragOver(true);}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault();setDragOver(false);handleFiles(e.dataTransfer.files);}}
          style={{border:`2px dashed ${dragOver?C.blauw:C.border}`,borderRadius:10,padding:"16px",textAlign:"center",background:dragOver?C.blauw+"08":C.bg,transition:"all .2s"}}>
          <div style={{fontSize:28,marginBottom:6}}>📸</div>
          <div style={{fontSize:13,fontWeight:600,color:C.blauw,marginBottom:4}}>Klik of sleep bestanden hierheen</div>
          <div style={{fontSize:11,color:C.muted}}>Foto's, PDF's of documenten (max 50MB per bestand)</div>
          <input type="file" multiple accept="image/*,.pdf,.doc,.docx" onChange={e=>handleFiles(e.target.files)} style={{display:"none"}}/>
        </div>
      </label>

      {bestanden.length > 0 && (
        <div style={{marginTop:12}}>
          {/* Foto previews */}
          {bestanden.some(b=>b.preview) && (
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:8}}>
              {bestanden.filter(b=>b.preview).map((b,i)=>(
                <div key={i} style={{position:"relative"}}>
                  <img src={b.preview} alt={b.naam} style={{width:80,height:80,objectFit:"cover",borderRadius:8,border:`1px solid ${C.border}`}}/>
                  <button onClick={()=>setBestanden(prev=>prev.filter((_,j)=>prev.indexOf(b)!==j||(j!==prev.indexOf(b))))}
                    style={{position:"absolute",top:-6,right:-6,background:"#ef4444",color:"white",border:"none",borderRadius:"50%",width:18,height:18,fontSize:11,cursor:"pointer",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                </div>
              ))}
            </div>
          )}
          {/* Niet-foto bestanden */}
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {bestanden.filter(b=>!b.preview).map((b,i)=>(
              <div key={i} style={{display:"inline-flex",alignItems:"center",gap:6,background:C.bg,border:`1px solid ${C.border}`,borderRadius:20,padding:"4px 10px",fontSize:12}}>
                <span>📄</span>
                <span>{b.naam.length>20?b.naam.slice(0,20)+"...":b.naam}</span>
                <span style={{color:C.muted,fontSize:11}}>({Math.round(b.grootte/1024)}KB)</span>
                <button onClick={()=>setBestanden(prev=>prev.filter((_,j)=>j!==i))}
                  style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 2px"}}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BIJLAGE WEERGAVE (readonly) ──────────────────────────────────────────────
export function BijlageWeergave({ bijlages }) {
  const [lightbox, setLightbox] = useState(null);
  if (!bijlages || bijlages.length === 0) return null;

  const fotos = bijlages.filter(b => b.url && (b.type?.startsWith("image/") || b.url.match(/\.(jpg|jpeg|png|gif|webp)$/i)));
  const docs  = bijlages.filter(b => !fotos.includes(b));

  return (
    <div style={{marginTop:10}}>
      {fotos.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:8}}>
          {fotos.map((b,i) => (
            <img key={i} src={b.url} alt={b.naam} onClick={()=>setLightbox(b.url)}
              style={{width:70,height:70,objectFit:"cover",borderRadius:8,border:`1px solid ${C.border}`,cursor:"pointer",transition:"transform .2s"}}
              onMouseOver={e=>e.target.style.transform="scale(1.05)"}
              onMouseOut={e=>e.target.style.transform="scale(1)"}/>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {docs.map((b,i) => (
            <a key={i} href={b.url} target="_blank" rel="noopener noreferrer"
              style={{display:"inline-flex",alignItems:"center",gap:6,background:C.bg,border:`1px solid ${C.border}`,borderRadius:20,padding:"4px 10px",fontSize:12,color:C.blauw,textDecoration:"none"}}>
              📄 {b.naam?.length>20?b.naam.slice(0,20)+"...":b.naam||"Bijlage"}
            </a>
          ))}
        </div>
      )}
      {lightbox && (
        <div onClick={()=>setLightbox(null)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",cursor:"zoom-out"}}>
          <img src={lightbox} alt="Bijlage" style={{maxWidth:"90vw",maxHeight:"90vh",objectFit:"contain",borderRadius:12}}/>
          <button onClick={()=>setLightbox(null)}
            style={{position:"absolute",top:20,right:20,background:"white",border:"none",borderRadius:"50%",width:36,height:36,fontSize:20,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
      )}
    </div>
  );
}
