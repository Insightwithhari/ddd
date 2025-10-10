// This is a Vercel Serverless Function to run BLASTp searches via EMBL-EBI API.
// It abstracts away the polling mechanism from the frontend.

// Using `any` for request and response types to avoid dependency on `@vercel/node`.
// Vercel's environment provides a Node.js-like environment where `fetch` is available globally.
export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { sequence } = req.body;
    if (!sequence || typeof sequence !== 'string') {
        return res.status(400).json({ error: 'A valid protein sequence is required.' });
    }

    try {
        // 1. Submit the BLASTp job to EMBL-EBI
        const params = new URLSearchParams();
        params.append('program', 'blastp');
        params.append('database', 'uniprotkb');
        params.append('sequence', sequence);
        params.append('email', 'test@example.com'); // A valid email is required by the API.

        const submitResponse = await fetch('https://www.ebi.ac.uk/Tools/services/rest/blast/run', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/plain',
            },
            body: params.toString()
        });

        if (!submitResponse.ok) {
            throw new Error(`EBI job submission failed: ${await submitResponse.text()}`);
        }
        const jobId = await submitResponse.text();

        // 2. Poll for the job status
        let status = '';
        const startTime = Date.now();
        while (status !== 'FINISHED') {
            // Set a timeout to prevent infinitely running function (e.g., 55 seconds)
            if (Date.now() - startTime > 55000) {
                throw new Error('BLAST job timed out after 55 seconds.');
            }

            // Wait for 3 seconds before checking the status again
            await new Promise(resolve => setTimeout(resolve, 3000));

            const statusResponse = await fetch(`https://www.ebi.ac.uk/Tools/services/rest/blast/status/${jobId}`);
            if (!statusResponse.ok) {
                 throw new Error(`Failed to get job status for job ID: ${jobId}`);
            }
            status = await statusResponse.text();

            if (status === 'FAILURE' || status === 'ERROR') {
                throw new Error(`BLAST job failed with status: ${status}`);
            }
        }

        // 3. Fetch the results in JSON format
        const resultResponse = await fetch(`https://www.ebi.ac.uk/Tools/services/rest/blast/result/${jobId}/json`);
        if (!resultResponse.ok) {
            throw new Error(`Failed to fetch results: ${await resultResponse.text()}`);
        }
        const resultsJson = await resultResponse.json();

        // 4. Transform the results into the format our frontend expects
        if (!resultsJson.results || !resultsJson.results.hits) {
            return res.status(200).json([]);
        }

        const formattedHits = resultsJson.results.hits.slice(0, 10).map((hit: any) => {
            if (!hit.hsps || hit.hsps.length === 0) return null;
            const hsp = hit.hsps[0];
            return {
                description: hit.description,
                score: hsp.scores.bit_score,
                e_value: hsp.stats.evalue.toExponential(), // Convert number to scientific notation string
                identity: hsp.identity / 100 // Convert percentage (e.g., 95.5) to a 0-1 float
            };
        }).filter(Boolean); // Filter out any null entries if a hit had no HSPs

        return res.status(200).json(formattedHits);

    } catch (error: any) {
        console.error('BLASTp API Error:', error);
        return res.status(500).json({ error: error.message || 'An unknown error occurred.' });
    }
}
