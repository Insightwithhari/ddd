import React, { useEffect, useRef, useState, useMemo } from 'react';
import { DownloadIcon, WhatsAppIcon } from './icons';

declare const $3Dmol: any;

interface PDBViewerProps {
  pdbId?: string;
  uniprotId?: string;
}

const PDBViewer: React.FC<PDBViewerProps> = ({ pdbId, uniprotId }) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const structureInfo = useMemo(() => {
    if (pdbId) {
      return {
        fetchUrl: `https://files.rcsb.org/view/${pdbId}.pdb`,
        downloadUrl: `https://files.rcsb.org/view/${pdbId}.pdb`,
        shareUrl: `https://www.rcsb.org/structure/${pdbId}`,
        downloadFileName: `${pdbId}.pdb`,
        displayId: pdbId,
        sourceName: 'RCSB PDB',
      };
    }
    if (uniprotId) {
      return {
        fetchUrl: `https://alphafold.ebi.ac.uk/files/AF-${uniprotId}-F1-model_v4.pdb`,
        downloadUrl: `https://alphafold.ebi.ac.uk/files/AF-${uniprotId}-F1-model_v4.pdb`,
        shareUrl: `https://alphafold.ebi.ac.uk/entry/${uniprotId}`,
        downloadFileName: `AF-${uniprotId}-F1.pdb`,
        displayId: uniprotId,
        sourceName: 'AlphaFold DB',
      };
    }
    return null;
  }, [pdbId, uniprotId]);

  useEffect(() => {
    let viewer: any = null;

    if (typeof $3Dmol === 'undefined' || !$3Dmol) {
        setError("3D viewer library (3Dmol.js) failed to load. Please check your network connection and refresh.");
        setIsLoading(false);
        return;
    }

    if (viewerRef.current && structureInfo) {
      setIsLoading(true);
      setError(null);
      const element = viewerRef.current;
      const config = { backgroundColor: 'black' };
      viewer = $3Dmol.createViewer(element, config);

      fetch(structureInfo.fetchUrl)
        .then((res) => {
          if (!res.ok) {
            if (res.status === 404) {
                 throw new Error(`Structure ${structureInfo.displayId} not found in ${structureInfo.sourceName}.`);
            }
            throw new Error(`Failed to fetch PDB data for ${structureInfo.displayId}. Status: ${res.status}`);
          }
          return res.text();
        })
        .then((pdbData) => {
          viewer.addModel(pdbData, 'pdb');
          viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
          viewer.zoomTo();
          viewer.render(() => {
            viewer.zoom(0.8);
          });
          setIsLoading(false);
        })
        .catch((err) => {
          console.error("PDB fetch error:", err);
          setError(err.message || `Could not load structure for ID: ${structureInfo.displayId}. Please ensure it's a valid ID.`);
          setIsLoading(false);
        });
    } else if (!structureInfo) {
        setError("No PDB ID or UniProt ID was provided to the viewer.");
        setIsLoading(false);
    }

    return () => {
      if (viewer && viewer.clear) {
        viewer.clear();
      }
    };
  }, [structureInfo]);
  
  const handleDownload = () => {
    if (!structureInfo) return;
    fetch(structureInfo.downloadUrl)
      .then(res => res.text())
      .then(data => {
        const blob = new Blob([data], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = structureInfo.downloadFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(err => console.error("Download error:", err));
  };

  const handleWhatsAppShare = () => {
    if (!structureInfo) return;
    const text = `Check out this protein structure from ${structureInfo.sourceName}: ${structureInfo.displayId}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${text}\n${structureInfo.shareUrl}`)}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <div className="mt-4 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-700 bg-black min-h-[400px] w-full max-w-2xl relative">
      {isLoading && <div className="absolute inset-0 flex items-center justify-center text-white bg-black bg-opacity-70 z-10">Loading 3D View...</div>}
      {error && <div className="absolute inset-0 flex items-center justify-center text-red-400 p-4 text-center z-10">{error}</div>}
      <div ref={viewerRef} style={{ width: '100%', height: '400px', position: 'relative' }} />
      {!isLoading && !error && (
        <div className="absolute top-2 right-2 flex gap-2 z-10">
            <button onClick={handleWhatsAppShare} className="p-2 bg-slate-800/70 text-white rounded-full hover:bg-slate-700 transition-colors" title="Share via WhatsApp">
                <WhatsAppIcon className="w-5 h-5" />
            </button>
            <button onClick={handleDownload} className="p-2 bg-slate-800/70 text-white rounded-full hover:bg-slate-700 transition-colors" title="Download PDB file">
                <DownloadIcon />
            </button>
        </div>
      )}
    </div>
  );
};

export default PDBViewer;
