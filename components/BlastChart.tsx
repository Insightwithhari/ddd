import React, { useState, useMemo } from 'react';
import type { BlastHit } from '../types';
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'https://esm.sh/recharts@2.12.7';
import ErrorBoundary from './ErrorBoundary';
import { ExclamationTriangleIcon } from './icons';

interface BlastViewerProps {
  data: BlastHit[];
}

interface CustomTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: BlastHit & { identityPercent: number, negLogEValue: number } }>;
    label?: string | number;
}

const CustomScatterTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="p-2 bg-slate-700 text-white rounded-md shadow-lg border border-slate-600 text-sm max-w-xs">
        <p className="font-bold truncate">{data.description}</p>
        <p className="primary-text">{`Score: ${data.score}`}</p>
        <p>{`Identity: ${data.identityPercent.toFixed(1)}%`}</p>
        <p>{`E-value: ${data.e_value}`}</p>
      </div>
    );
  }
  return null;
};

const BlastScatterChart: React.FC<{ data: BlastHit[] }> = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-[300px] text-center text-sm text-[var(--muted-foreground-color)]">
                No BLAST hits to display in chart.
            </div>
        );
    }
    
    const chartData = useMemo(() => data.map(hit => ({
        ...hit,
        identityPercent: hit.identity * 100,
        negLogEValue: -Math.log10(parseFloat(hit.e_value) || 1e-200),
    })).filter(d => d.negLogEValue >= 0), [data]);

    return (
        <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128, 128, 128, 0.2)" />
                    <XAxis type="number" dataKey="identityPercent" name="Identity" unit="%" domain={[0, 100]} />
                    <YAxis type="number" dataKey="score" name="Score" />
                    <ZAxis type="number" dataKey="negLogEValue" range={[20, 400]} name="-log10(e-value)" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<CustomScatterTooltip />} />
                    <Legend />
                    <Scatter name="BLAST Hits" data={chartData} fill="var(--primary-color)" fillOpacity={0.6} />
                </ScatterChart>
            </ResponsiveContainer>
        </div>
    );
};

const AlignmentDetail: React.FC<{ hit: BlastHit }> = ({ hit }) => {
    if (!hit.qseq || !hit.midline || !hit.hseq) {
        return <div className="p-4 text-sm text-slate-500">Alignment details not available.</div>;
    }

    const formatAlignment = (qseq: string, midline: string, hseq: string, lineLength = 60) => {
        const lines = [];
        for (let i = 0; i < qseq.length; i += lineLength) {
            lines.push({
                q: qseq.substring(i, i + lineLength),
                m: midline.substring(i, i + lineLength),
                h: hseq.substring(i, i + lineLength),
            });
        }
        return lines;
    };

    const alignmentLines = formatAlignment(hit.qseq, hit.midline, hit.hseq);

    return (
        <div className="p-4 bg-slate-100 dark:bg-slate-900/50 rounded-md">
            <h4 className="font-semibold text-sm mb-2">Sequence Alignment</h4>
            <pre className="font-mono text-xs overflow-x-auto">
                {alignmentLines.map((line, index) => (
                    <div key={index} className="mb-2">
                        <div><span className="font-bold w-12 inline-block">Query:</span> {line.q}</div>
                        <div><span className="font-bold w-12 inline-block">       </span> {line.m}</div>
                        <div><span className="font-bold w-12 inline-block">Sbjct:</span> {line.h}</div>
                    </div>
                ))}
            </pre>
        </div>
    );
};


const SortableTable: React.FC<{ data: BlastHit[] }> = ({ data }) => {
    const [sortConfig, setSortConfig] = useState<{ key: keyof BlastHit; direction: 'asc' | 'desc' } | null>({ key: 'score', direction: 'desc' });
    const [expandedRow, setExpandedRow] = useState<string | null>(null);

    const sortedData = useMemo(() => {
        let sortableData = [...data];
        if (sortConfig !== null) {
            sortableData.sort((a, b) => {
                const valA = a[sortConfig.key];
                const valB = b[sortConfig.key];
                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortableData;
    }, [data, sortConfig]);

    const requestSort = (key: keyof BlastHit) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const getSortIndicator = (key: keyof BlastHit) => {
        if (!sortConfig || sortConfig.key !== key) return null;
        return sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
    };

    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-[300px] text-center text-sm text-[var(--muted-foreground-color)]">
                No BLAST hits to display in table.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="bg-slate-200 dark:bg-slate-700">
                    <tr>
                        <th className="p-2 cursor-pointer" onClick={() => requestSort('accession')}>Accession{getSortIndicator('accession')}</th>
                        <th className="p-2">Description</th>
                        <th className="p-2 cursor-pointer" onClick={() => requestSort('score')}>Score{getSortIndicator('score')}</th>
                        <th className="p-2 cursor-pointer" onClick={() => requestSort('e_value')}>E-value{getSortIndicator('e_value')}</th>
                        <th className="p-2 cursor-pointer" onClick={() => requestSort('identity')}>Identity{getSortIndicator('identity')}</th>
                    </tr>
                </thead>
                <tbody>
                    {sortedData.map((hit) => (
                        <React.Fragment key={hit.accession}>
                            <tr 
                                className="border-b border-[var(--border-color)] cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/50"
                                onClick={() => setExpandedRow(expandedRow === hit.accession ? null : hit.accession)}
                            >
                                <td className="p-2 font-mono">
                                    <a href={`https://www.uniprot.org/uniprotkb/${hit.accession}/entry`} target="_blank" rel="noopener noreferrer" className="primary-text hover:underline" onClick={e => e.stopPropagation()}>
                                        {hit.accession}
                                    </a>
                                </td>
                                <td className="p-2">{hit.description}</td>
                                <td className="p-2">{hit.score}</td>
                                <td className="p-2">{hit.e_value}</td>
                                <td className="p-2">{(hit.identity * 100).toFixed(1)}%</td>
                            </tr>
                            {expandedRow === hit.accession && (
                                <tr className="border-b border-[var(--border-color)]">
                                    <td colSpan={5} className="p-0">
                                        <AlignmentDetail hit={hit} />
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const BlastViewer: React.FC<BlastViewerProps> = ({ data }) => {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  
  const ChartFallback = (
    <div className="flex flex-col items-center justify-center h-[300px] text-center text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-4 rounded-md">
        <ExclamationTriangleIcon className="w-8 h-8 mb-2" />
        <p className="font-semibold">Could not render chart.</p>
        <p className="text-xs text-red-400">The data might be malformed. Please try the table view.</p>
    </div>
  );

  return (
    <div>
      <div className="flex justify-end gap-1 mb-2">
        <button 
            onClick={() => setViewMode('chart')} 
            className={`px-3 py-1 text-xs rounded-full ${viewMode === 'chart' ? 'primary-bg text-white' : 'bg-slate-200 dark:bg-slate-600'}`}
            aria-label="Switch to chart view"
        >
            Chart
        </button>
        <button 
            onClick={() => setViewMode('table')} 
            className={`px-3 py-1 text-xs rounded-full ${viewMode === 'table' ? 'primary-bg text-white' : 'bg-slate-200 dark:bg-slate-600'}`}
            aria-label="Switch to table view"
        >
            Table
        </button>
      </div>
      {/* FIX: Replaced ternary operator with logical AND operators for conditional rendering. 
          This can sometimes resolve subtle type inference issues with JSX children. */}
      {viewMode === 'chart' && (
        <ErrorBoundary fallback={ChartFallback}>
            <BlastScatterChart data={data} />
        </ErrorBoundary>
      )}
      {viewMode === 'table' && (
        <SortableTable data={data} />
      )}
    </div>
  );
};

export default BlastViewer;
