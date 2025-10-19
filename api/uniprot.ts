// This is a Vercel Serverless Function to fetch protein sequences from UniProt.
// It takes a protein name, finds the best UniProt ID, and returns its sequence.

export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { proteinName } = req.body;

    if (typeof proteinName !== 'string' || proteinName.trim().length === 0) {
        return res.status(400).json({ error: 'A valid protein name is required.' });
    }

    try {
        // Step 1: Search for the protein to get its UniProt accession ID.
        // We prioritize reviewed (Swiss-Prot) entries.
        const searchQuery = `reviewed:true AND (${proteinName})`;
        const searchUrl = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(searchQuery)}&fields=accession,protein_name,organism_name&size=1`;

        const searchResponse = await fetch(searchUrl, {
            headers: { 'Accept': 'application/json' }
        });

        if (!searchResponse.ok) {
            throw new Error(`UniProt search failed with status: ${searchResponse.status}`);
        }

        const searchData = await searchResponse.json();
        
        if (!searchData.results || searchData.results.length === 0) {
            return res.status(404).json({ error: `No reviewed UniProt entry found for "${proteinName}". Try a more specific name (e.g., "human insulin").` });
        }

        const entry = searchData.results[0];
        const accession = entry.primaryAccession;
        const proteinDesc = entry.proteinDescription;
        const fetchedProteinName = proteinDesc?.recommendedName?.fullName?.value || proteinDesc?.submissionNames?.[0]?.fullName?.value || 'Unknown Protein';
        const organismName = entry.organism.scientificName;

        // Step 2: Fetch the FASTA sequence for the accession ID.
        const fastaUrl = `https://www.uniprot.org/uniprotkb/${accession}.fasta`;
        const fastaResponse = await fetch(fastaUrl);

        if (!fastaResponse.ok) {
            throw new Error(`Failed to fetch FASTA sequence for ${accession}. Status: ${fastaResponse.status}`);
        }

        const fastaText = await fastaResponse.text();

        // Step 3: Parse the FASTA text to extract the sequence.
        const sequence = fastaText.split('\n').slice(1).join('');

        if (!sequence) {
             throw new Error(`Could not parse sequence from FASTA for ${accession}.`);
        }

        // Step 4: Return the data.
        return res.status(200).json({
            accession,
            proteinName: fetchedProteinName,
            organismName,
            sequence
        });

    } catch (error: any) {
        console.error('UniProt API Error:', error);
        return res.status(500).json({ error: error.message || 'An unknown error occurred.' });
    }
}
