# Inventory Hub - PDF Extraction App

A React-based inventory management system with PDF invoice extraction using Claude AI.

## Features

✅ **PDF Invoice Upload** - Upload supplier invoices as PDF
✅ **AI-Powered Extraction** - Claude AI automatically extracts items, quantities, prices
✅ **Multi-Godown Management** - Track stock across 5+ godowns
✅ **Stock Entry Date** - Separate invoice date from stock entry date
✅ **Team Collaboration** - Multi-user login system
✅ **Export to CSV** - Download inventory as CSV for Busy accounting

## Setup

### 1. Prerequisites
- Node.js 14+ installed
- npm or yarn
- Anthropic API key (get from https://console.anthropic.com/api/keys)

### 2. Local Development

```bash
# Install dependencies
npm install

# Create .env file with your API key
echo "REACT_APP_ANTHROPIC_API_KEY=your_api_key_here" > .env

# Start the app
npm start
```

App will open at `http://localhost:3000`

### 3. Deploy to Vercel (Recommended)

1. Push this repository to GitHub
2. Go to https://vercel.com
3. Click "New Project" → Select this repository
4. Add Environment Variable:
   - Name: `REACT_APP_ANTHROPIC_API_KEY`
   - Value: Your Anthropic API key
5. Deploy

You'll get a live URL instantly!

## How to Use

### Adding Stock via PDF
1. Click **"Upload PDF"** button
2. Select your supplier invoice PDF
3. Claude AI extracts items automatically
4. Review extracted data
5. **Select Godown** for each item (required)
6. **Set Stock Entry Date** (can be different from invoice date)
7. Click **"Add All to Inventory"**

### Manual Entry
1. Click **"Add Stock Manually"**
2. Fill item name, quantity, godown
3. Click "Add Item"

### View & Issue Stock
1. Select "All Items" or "By Godown"
2. Search items by name
3. Click "Issue" to remove stock
4. Click "Export CSV" to download inventory

## API Key Setup

Get your free API key from [Anthropic Console](https://console.anthropic.com/api/keys)

### For Local Development
Create `.env` file:
```
REACT_APP_ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### For Vercel Deployment
Add in Vercel Settings → Environment Variables

## Technology Stack

- **React 18** - UI Framework
- **Claude API** - AI-powered PDF extraction
- **PDF.js** - PDF text extraction
- **Lucide Icons** - UI Icons
- **LocalStorage** - Data persistence

## File Structure

```
src/
  ├── App.jsx          # Main app component
  ├── index.jsx        # React entry point
  └── index.css        # Styles
public/
  └── index.html       # HTML template
package.json           # Dependencies
```

## Support

For issues with:
- **PDF Extraction** - Check that invoice has clear text (not scanned image)
- **API Key** - Verify key is valid at https://console.anthropic.com
- **Deployment** - Check Vercel logs for errors

## License

MIT
