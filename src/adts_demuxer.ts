import * as AV from 'av';
import * as tables from './tables';
import { Readable, PassThrough, Transform } from 'stream';

export interface ADTSHeader {
    profile?;
    samplingIndex?;
    chanConfig?;
    frameLength?;
    numFrames?;
}

// adts_fixed_header (28 bits)
// adts_variable_header (28 bits)
// adts_header_error_check (16 + 16 * number_of_raw_data_blocks_in_frame)
// 


export class ADTSDemuxer extends Transform {
    constructor(private stream : Readable) {
        super();
        this.bitstream = new AV.Bitstream(this.stream);
    }

    private bitstream : PassThrough;
    sentHeader;
    
    /**
     * Reads an ADTS header
     * See http://wiki.multimedia.cx/index.php?title=ADTS
     */
    readHeader(stream) {
        if (stream.read(12) !== 0xfff)
            throw new Error('Invalid ADTS header.');
            
        var ret : ADTSHeader = {};
        stream.advance(3); // mpeg version and layer
        var protectionAbsent = !!stream.read(1);
        
        ret.profile = stream.read(2) + 1;
        ret.samplingIndex = stream.read(4);
        
        stream.advance(1); // private
        ret.chanConfig = stream.read(3);
        stream.advance(4); // original/copy, home, copywrite, and copywrite start
        
        ret.frameLength = stream.read(13);
        stream.advance(11); // fullness
        
        ret.numFrames = stream.read(2) + 1;
        
        if (!protectionAbsent)
            stream.advance(16);
        
        return ret;
    }
    
    _transform(buffer : Buffer, encoding : string, done : Function) {
        if (!this.sentHeader) {
            var offset = this.stream.offset;
            var header = this.readHeader(this.bitstream);
            
            this.emit('format', {
                formatID: 'aac ',
                sampleRate: tables.SAMPLE_RATES[header.samplingIndex],
                channelsPerFrame: header.chanConfig,
                bitsPerChannel: 16
            });
            
            // generate a magic cookie from the ADTS header
            var cookie = new Uint8Array(2);
            cookie[0] = (header.profile << 3) | ((header.samplingIndex >> 1) & 7);
            cookie[1] = ((header.samplingIndex & 1) << 7) | (header.chanConfig << 3);
            this.emit('cookie', new AV.Buffer(cookie));
            
            this.stream.seek(offset);
            this.sentHeader = true;
        }
        
        while (this.stream.available(1)) {
            var buffer = this.stream.readSingleBuffer(this.stream.remainingBytes());
            this.emit('data', buffer);
        }
    };
});
