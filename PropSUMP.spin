{{
+-------------------------------------------------+
| SUMP-compatible Logic Analyzer                  |
| Interface Object                                |
|                                                 |
| Authors: Ben Gardiner & Joe Grand               |                     
| Copyright (c) 2015-2020 Ben Gardiner            |
| Copyright (c) 2018-2020 Joe Grand               |
|                                                 |
| Distributed under a Creative Commons            |
| Attribution 3.0 United States license           |
| http://creativecommons.org/licenses/by/3.0/us/  |
+-------------------------------------------------+

Program Description:

This object provides the low-level communication interface for the SUMP-compatible
logic analyzer functionality (http://sigrok.org/wiki/Openbench_Logic_Sniffer#Protocol
and http://dangerousprototypes.com/docs/Logic_Analyzer_core:_Background#2.3_The_SUMP_Protocol)

TODOs:
* don't waste 1024B of the 4096B buffer
* support trigger delays
* support serial trigger mode
* support RLE

}}
   
   
CON
  ' Serial terminal
  BaudRate      = 115_200                                             
  RxPin         = |<31                                              
  TxPin         = |<30

  ' Control characters
  CAN   = 24  ''CAN: Cancel (Ctrl-X)
                       
  MAX_INPUT_LEN                 = 5                    'SUMP long commands are five bytes
  MAX_SAMPLE_BYTES              = 4096
  MAX_PROBES                    = 24
  MAX_CH_GROUPS                 = MAX_PROBES / 8
  MAX_SAMPLE_PERIODS            = MAX_SAMPLE_BYTES / 4 'We capture 32bits at a time keep the sampler cog fast(er than it would be otherwise)
                                                       'TODO: don't waste 25% of the buffer *AND* get a >1Msps max sample rate :)
  MAX_RX_DELAY_MS               = 100                  'Wait time (in ms) for the each byte in long commands to be sent before aborting

  ' used to convert between the protocol requests based on the OLS 100MHz clock and the JTAGulator's 80MHz clock
  SR_FACTOR_NUM                 = 4      ' 80E6/100E6 = 4/5
  SR_FACTOR_DEN                 = 5             
 
  CMD_RESET                     = $00    ' reset
  CMD_RUN                       = $01    ' start capture or arm trigger
  CMD_QUERY_ID                  = $02    ' query device identification           
  CMD_QUERY_META                = $04    ' query metadata
  CMD_QUERY_INPUT_DATA          = $06    ' query input data (snapshot of current logic analyzer channels)
  CMD_DIV                       = $80    ' set divider
  CMD_CNT                       = $81    ' set read & delay count
  CMD_FLAGS                     = $82    ' set flags
  CMD_TRIG1_MASK                = $C0    ' set trigger mask
  CMD_TRIG2_MASK                = $C4
  CMD_TRIG3_MASK                = $C8
  CMD_TRIG4_MASK                = $CC
  CMD_TRIG1_VAL                 = $C1    ' set trigger values
  CMD_TRIG2_VAL                 = $C5
  CMD_TRIG3_VAL                 = $C9
  CMD_TRIG4_VAL                 = $CD
  CMD_TRIG1_CONF                = $C2    ' set trigger configuration
  CMD_TRIG2_CONF                = $C6
  CMD_TRIG3_CONF                = $CA
  CMD_TRIG4_CONF                = $CE

  DEFAULT_CLOCKS_WAIT           = 66     '1.2 MHz
  DEFAULT_READ_PERIODS          = MAX_SAMPLE_PERIODS 
  DEFAULT_DELAY_PERIODS         = DEFAULT_READ_PERIODS
  DEFAULT_DISABLE_FLAGS         = %00100000  ' disable ch group 4

  DISABLE_FLAGS_MASK            = %00111100

  TRIGGER_CH_MASK               = %00000000111111111111111111111111

  
VAR
  long Cog                      ' Used to store ID of newly started cog

  byte vCmd[MAX_INPUT_LEN + 1]  ' Buffer for command input string
  long larg

  
CON 'offsets of the structure below
  CLOCKSWAIT_OFF              =  0
  READPERIODS_OFF             =  4
  DELAYPERIODS_OFF            =  8
  DISABLEFLAGS_OFF            = 12
  TRIG1MASK_OFF               = 16
  TRIG2MASK_OFF               = 20
  TRIG3MASK_OFF               = 24
  TRIG4MASK_OFF               = 28
  TRIG1VAL_OFF                = 32
  TRIG2VAL_OFF                = 36
  TRIG3VAL_OFF                = 40
  TRIG4VAL_OFF                = 44
  ISTRIG1START_OFF            = 48
  ISTRIG2START_OFF            = 52
  ISTRIG3START_OFF            = 56
  ISTRIG4START_OFF            = 60
  SAMPLERRUNNING_OFF          = 64
  SAMPLEBUFFER_OFF            = 68
  PREPERIODS_OFF              = 72
  SAMPLEREND_OFF              = 76

  ' Pre-trigger capture polls the trigger in software, which needs more clocks per
  ' sample than WAITPEQ (worst case ~73), so its sample period is at least this.
  PRE_MIN_CLOCKS_WAIT         = 88

  
VAR 'This is a struct used by the sampler cog; its layout and the offsets above must be in sync
  long clocksWait 'struct head
  long readPeriods
  long delayPeriods
  long disableFlags

  long trig1Mask
  long trig2Mask
  long trig3Mask
  long trig4Mask

  long trig1Val
  long trig2Val
  long trig3Val
  long trig4Val

  long isTrig1Start
  long isTrig2Start
  long isTrig3Start
  long isTrig4Start

  long samplerRunning

  long sampleBuffer        ' Address of global buffer from top object
  long prePeriods          ' Samples kept from before the trigger (0 = no pre-trigger capture)
  long samplerEnd          ' Pre-trigger capture: address after the last sample written (oldest sample)


VAR
  long readReq             ' Counts requested with CMD_CNT
  long delayReq

  
OBJ
  u             : "JTAGulatorUtil"    ' JTAGulator general purpose utilities
  pst           : "JDCogSerial"       ' UART/Asynchronous Serial communication engine (Carl Jacobs, http://obex.parallax.com/object/298)
  

PRI Start    ' Start a new cog to run PASM routine 
  Stop                                           ' Call the Stop function, just in case the calling object called Start two times in a row
  Cog := cognew(@samplerInit, @clocksWait) + 1   ' Launch the cog with a pointer to the parameters
  if Cog =< 0    ' Failed to start SUMP sampler
    repeat  ' Repeat until system reset
      u.LEDYellow
      u.Pause(500)
      u.LEDOff
      u.Pause(500)
      

PRI Stop
  ' Stop the cog we started earlier, if any
  if Cog
    cogstop(Cog~ - 1)
    Cog := 0
    

PUB Go(bufPtr) | coggood, i, isSendSamples
  pst.Start(RxPin, TxPin, BaudRate)  ' Configure UART

  sampleBuffer := bufPtr

  clocksWait:=DEFAULT_CLOCKS_WAIT
  readPeriods:=DEFAULT_READ_PERIODS 
  delayPeriods:=DEFAULT_DELAY_PERIODS
  readReq:=DEFAULT_READ_PERIODS
  delayReq:=DEFAULT_DELAY_PERIODS
  prePeriods:=0
  disableFlags:=DEFAULT_DISABLE_FLAGS

  trig1Mask:=0
  trig2Mask:=0
  trig3Mask:=0
  trig4Mask:=0

  trig1Val:=0
  trig2Val:=0
  trig3Val:=0
  trig4Val:=0

  isTrig1Start:=1
  isTrig2Start:=1
  isTrig3Start:=1
  isTrig4Start:=1

  samplerRunning:=0

  Start                   ' Start sampler cog

  u.LEDRed                ' We are initialized and ready to go
  u.TXSEnable             ' Enable level shifter outputs (all channels set to inputs)
  
  ' Start command receive/process cycle
  repeat
    vCmd[0]:=pst.Rx

    case vCmd[0]
      CAN:          ' If Ctrl-X (CAN) character received, exit SUMP mode
        Stop          ' Stop sampler cog
        pst.Stop      ' Stop serial communications
        return        ' Go back to main JTAGulator mode

      'the 'short' commands follow; all are 1 byte, no parameters

      CMD_RESET:
        if samplerRunning   ' If the sampler cog is still running, capture was likely stopped by user
          samplerRunning:=0
          Stop        ' Stop sampler cog
          Start       ' Restart sampler cog
          u.LEDRed

      CMD_QUERY_ID:
        pst.StrMax(@ID, @METADATA - @ID)

      CMD_QUERY_META:
        pst.StrMax(@METADATA, @END_METADATA - @METADATA + 1)
     
      CMD_QUERY_INPUT_DATA: 
        SendSamples(ina[23..0])

      CMD_RUN:
        ' Asking for more samples than after the trigger means "keep the rest from
        ' before it". That needs a stage 1 trigger that starts the capture.
        if (readReq > delayReq) and (trig1Mask <> 0) and (isTrig1Start <> 0)
          prePeriods := readReq - delayReq
          delayPeriods := readReq         ' Ring buffer size
          readPeriods := readReq
          clocksWait #>= PRE_MIN_CLOCKS_WAIT
        else
          prePeriods := 0
          delayPeriods := delayReq
          readPeriods := readReq <# delayReq
        u.LEDYellow
        i:=0
        repeat while i < MAX_SAMPLE_PERIODS ' Clear buffer before starting capture
          long[sampleBuffer][i++]:=$00000000

        samplerRunning:=1                   ' Arm the sampler cog
        isSendSamples:=1                    ' Send samples after successful capture
        repeat until (samplerRunning == 0)  ' Wait for the sampler cog to finish
          vCmd[0]:=pst.RxCheck                ' Check if byte is sent from client during capture

          case vCmd[0]
            CAN:          ' If Ctrl-X (CAN) character received, exit SUMP mode
              Stop          ' Stop sampler cog
              pst.Stop      ' Stop serial communications
              return        ' Go back to main JTAGulator mode

            CMD_RESET:    ' If user canceled before trigger or acquisition is complete
              isSendSamples:=0
              samplerRunning:=0
              Stop          ' Stop sampler cog
              Start         ' Restart sampler cog

        if isSendSamples
          SendAllSamples
          
        u.LEDRed
        
      'remaining commands are 'long' commands, which all take 4 parameters

      CMD_CNT:
        if (GetFourMoreParamBytes == -1)
          next
        larg:=vCmd[2]
        larg<<=8
        larg|=vCmd[1]
        readReq:=(larg+1)*4   'the protocol doesn't indicate the +1 is needed; but sigrok's OLS API does
        if readReq > DEFAULT_READ_PERIODS
          readReq:=DEFAULT_READ_PERIODS

        larg:=vCmd[4]
        larg<<=8
        larg|=vCmd[3]
        delayReq:=(larg+1)*4  'the protocol doesn't indicate the +1 is needed; but sigrok's OLS API does
        if delayReq > DEFAULT_DELAY_PERIODS
          delayReq:=DEFAULT_DELAY_PERIODS
        ' The read/delay split is resolved when the capture starts (CMD_RUN)
                          
      CMD_DIV:
        if (GetFourMoreParamBytes == -1)
          next
        larg:=vCmd[3]
        larg<<=8
        larg|=vCmd[2]
        larg<<=8
        larg|=vCmd[1]

        clocksWait:=((larg+1)*SR_FACTOR_NUM)/SR_FACTOR_DEN 
        if clocksWait < DEFAULT_CLOCKS_WAIT    ' set minimum allowable value
          clocksWait:=DEFAULT_CLOCKS_WAIT
       
      CMD_FLAGS:
        if (GetFourMoreParamBytes == -1)
          next
        disableFlags:=vCmd[1] & DISABLE_FLAGS_MASK

      ' Trigger stage n (0..3) is in bits 3..2 of the command; the per-stage
      ' masks, values and start flags are consecutive longs in the struct.
      CMD_TRIG1_MASK, CMD_TRIG2_MASK, CMD_TRIG3_MASK, CMD_TRIG4_MASK:
        if (GetFourMoreParamBytes == -1)
          next
        trig1Mask[(vCmd[0] >> 2) & 3] := ParamLong & TRIGGER_CH_MASK

      CMD_TRIG1_VAL, CMD_TRIG2_VAL, CMD_TRIG3_VAL, CMD_TRIG4_VAL:
        if (GetFourMoreParamBytes == -1)
          next
        trig1Val[(vCmd[0] >> 2) & 3] := ParamLong & TRIGGER_CH_MASK

      'TODO: support full triggers including delays and serial forms; for now support only sigrok OLS features
      CMD_TRIG1_CONF, CMD_TRIG2_CONF, CMD_TRIG3_CONF, CMD_TRIG4_CONF:
        if (GetFourMoreParamBytes == -1)
          next
        isTrig1Start[(vCmd[0] >> 2) & 3] := (vCmd[4] & 1<<3)   ' NB: stage 4 always starts the sampler


PRI ParamLong
  ' The four parameter bytes of a long command, little endian
  return vCmd[1] | vCmd[2] << 8 | vCmd[3] << 16 | vCmd[4] << 24


PRI GetFourMoreParamBytes : val
  if (vCmd[1]:=pst.RxTime(MAX_RX_DELAY_MS)) < 0
    val:=-1  
  if (vCmd[2]:=pst.RxTime(MAX_RX_DELAY_MS)) < 0
    val:=-1
  if (vCmd[3]:=pst.RxTime(MAX_RX_DELAY_MS)) < 0
    val:=-1
  if (vCmd[4]:=pst.RxTime(MAX_RX_DELAY_MS)) < 0
    val:=-1
  
                 
PRI SendAllSamples | i, e   'NB: OLS sends samples in reverse
  i := 0
  if prePeriods
    ' Ring buffer of delayPeriods samples; samplerEnd points at the oldest one
    e := (samplerEnd - sampleBuffer) >> 2
    repeat while i < readPeriods
      e := (e + delayPeriods - 1) // delayPeriods
      SendSamples(long[sampleBuffer][e])
      ++i
  else
    repeat while i < readPeriods
      SendSamples(long[sampleBuffer][delayPeriods - 1 - i])
      ++i

    
PRI SendSamples(value) | b
  'bits:            %76543210
  'ch disable flag:  --4321--
  if disableFlags & %00000100 == 0
    b:=(value) & $FF
    pst.Tx(b)
    
  'ch disable flag:  --4321--
  if disableFlags & %00001000 == 0
    b:=(value >> 8) & $FF
    pst.Tx(b)
    
  'ch disable flag:  --4321--
  if disableFlags & %00010000 == 0
    b:=(value >> 16) & $FF
    pst.Tx(b)

  'channel group 4 not currently used since JTAGulator has 24 channels (3 groups of 8-bits)
    
    
DAT             

              ORG
ID            byte "1ALS"

METADATA      byte $01, "JTAGulator", $00 ' device name
              byte $21
              byte $00, $00, $0c, $00     ' sample memory 3072 in MSB -- must match MAX_SAMPLE_PERIODS*MAX_CH_GROUPS
              byte $23
              byte $00, $12, $4F, $80     ' 1_200_000 in MSB (1.2MHz) -- highest stable sample rate 
              byte $40
              byte MAX_PROBES             ' number of probes
              byte $41
              byte $02                    ' protocol version 2
END_METADATA  byte $00

'*****************************
'* the sampler               *
'*****************************

                        ORG 0
samplerInit             MOVS    samplerTramp,       #samplerOff
                        MOV     samplerRunningA,    PAR
                        ADD     samplerRunningA,    #SAMPLERRUNNING_OFF

                        JMP     #samplerCommon

'check samplerRunning; arm if set
samplerOff              RDLONG  t1,                 samplerRunningA     WZ
              IF_NE     MOVS    samplerTramp,       #samplerArm
                        JMP     #samplerCommon 
                        
samplerArm              MOVS    samplerTramp,       #samplerArmed1

                        MOV     samplerTargetA,     PAR                     
                        ADD     samplerTargetA,     #SAMPLEBUFFER_OFF  
                        RDLONG  samplerTargetA,     samplerTargetA       ' point to the beginning of sampleBuffer
                        
                        MOV     t1,                 PAR
                        ADD     t1,                 #DELAYPERIODS_OFF
                        RDLONG  samplerLimitA,      t1
                        SHL     samplerLimitA,      #2                   ' we capture 4 channels at a time
                        ADD     samplerLimitA,      samplerTargetA

                        MOV     t1,                 PAR
                        ADD     t1,                 #CLOCKSWAIT_OFF
                        RDLONG  samplerWait,        t1

                        MOV     t1,                 PAR
                        ADD     t1,                 #TRIG1VAL_OFF
                        RDLONG  samplerTrigVal,     t1
                        MOV     t1,                 PAR
                        ADD     t1,                 #TRIG1MASK_OFF
                        RDLONG  samplerTrigMask,    t1
                        MOV     t1,                 PAR
                        ADD     t1,                 #ISTRIG1START_OFF
                        RDLONG  samplerTrigStart,   t1

                        ' Pre-trigger capture? (Spin only sets prePeriods with a stage 1 start trigger)
                        MOV     samplerBaseA,       samplerTargetA
                        MOV     t1,                 PAR
                        ADD     t1,                 #PREPERIODS_OFF
                        RDLONG  samplerPreLeft,     t1                  WZ
              IF_Z      JMP     #samplerCommon
                        MOV     samplerPostLeft,    samplerLimitA       ' post-trigger samples = ring size - pre
                        SUB     samplerPostLeft,    samplerBaseA
                        SHR     samplerPostLeft,    #2
                        SUB     samplerPostLeft,    samplerPreLeft
                        MOVS    samplerTramp,       #samplerPreStart
                        JMP     #samplerCommon

samplerArmed1           CMP     samplerTrigMask,    #0                  WZ
              IF_NE     WAITPEQ samplerTrigVal,     samplerTrigMask

                        CMP     samplerTrigStart,   #0                  WZ
              IF_NE     MOVS    samplerTramp,       #samplerStart
              IF_NE     JMP     #samplerCommon

                        MOVS    samplerTramp,       #samplerArmed2
                        MOV     t1,                 PAR
                        ADD     t1,                 #TRIG2VAL_OFF
                        RDLONG  samplerTrigVal,     t1
                        MOV     t1,                 PAR
                        ADD     t1,                 #TRIG2MASK_OFF
                        RDLONG  samplerTrigMask,    t1
                        MOV     t1,                 PAR
                        ADD     t1,                 #ISTRIG2START_OFF
                        RDLONG  samplerTrigStart,   t1
                        JMP     #samplerCommon

samplerArmed2           CMP     samplerTrigMask,    #0                  WZ
              IF_NE     WAITPEQ samplerTrigVal,     samplerTrigMask

                        CMP     samplerTrigStart,   #0                  WZ
              IF_NE     MOVS    samplerTramp,       #samplerStart
              IF_NE     JMP     #samplerCommon

                        MOVS    samplerTramp,       #samplerArmed3
                        MOV     t1,                 PAR
                        ADD     t1,                 #TRIG3VAL_OFF
                        RDLONG  samplerTrigVal,     t1
                        MOV     t1,                 PAR
                        ADD     t1,                 #TRIG3MASK_OFF
                        RDLONG  samplerTrigMask,    t1
                        MOV     t1,                 PAR
                        ADD     t1,                 #ISTRIG3START_OFF
                        RDLONG  samplerTrigStart,   t1
                        JMP     #samplerCommon

samplerArmed3           CMP     samplerTrigMask,    #0                  WZ
              IF_NE     WAITPEQ samplerTrigVal,     samplerTrigMask

                        CMP     samplerTrigStart,   #0                  WZ
              IF_NE     MOVS    samplerTramp,       #samplerStart
              IF_NE     JMP     #samplerCommon

                        MOVS    samplerTramp,       #samplerArmed4
                        MOV     t1,                 PAR
                        ADD     t1,                 #TRIG4VAL_OFF
                        RDLONG  samplerTrigVal,     t1
                        MOV     t1,                 PAR
                        ADD     t1,                 #TRIG4MASK_OFF
                        RDLONG  samplerTrigMask,    t1
                        JMP     #samplerCommon

samplerArmed4           CMP     samplerTrigMask,    #0                  WZ
              IF_NE     WAITPEQ samplerTrigVal,     samplerTrigMask

                        MOVS    samplerTramp,       #samplerStart
                        JMP     #samplerCommon
                                  
samplerStart            MOVS    samplerTramp,       #samplerSampling
                        MOV     samplerStamp,       CNT
                        ADD     samplerStamp,       samplerWait
                        JMP     #samplerCommon

samplerSampling         MOV     t1,                 INA
                        WRLONG  t1,                 samplerTargetA       'the rate-limiting step in the sampler
                        ADD     samplerTargetA,     #4                   'TODO: inc by 3 here (and waste a byte before the buffer) to reclaim wasted 1/4 of 4096 buffer
                        
                        CMP     samplerTargetA,     samplerLimitA       WZ
              IF_E      MOVS    samplerTramp,       #samplerFinish

              IF_NE     WAITCNT samplerStamp,       samplerWait
samplerCommon           JMP     samplerTramp

' Pre-trigger capture: sample continuously into a ring buffer while polling the
' trigger. The trigger is only checked once prePeriods samples of history exist;
' the triggering sample is the first post-trigger sample.
samplerPreStart         MOVS    samplerTramp,       #samplerPre
                        MOV     samplerStamp,       CNT
                        ADD     samplerStamp,       samplerWait
                        JMP     #samplerCommon

samplerPre              MOV     t1,                 INA
                        WRLONG  t1,                 samplerTargetA
                        ADD     samplerTargetA,     #4
                        CMP     samplerTargetA,     samplerLimitA       WZ
              IF_E      MOV     samplerTargetA,     samplerBaseA
                        CMP     samplerPreLeft,     #0                  WZ
              IF_NZ     SUB     samplerPreLeft,     #1
                        AND     t1,                 samplerTrigMask
              IF_Z      CMP     t1,                 samplerTrigVal      WZ
              IF_Z      MOVS    samplerTramp,       #samplerPost
              IF_Z      SUB     samplerPostLeft,    #1
                        WAITCNT samplerStamp,       samplerWait
                        JMP     samplerTramp

samplerPost             CMP     samplerPostLeft,    #0                  WZ
              IF_Z      JMP     #samplerPreDone
                        MOV     t1,                 INA
                        WRLONG  t1,                 samplerTargetA
                        ADD     samplerTargetA,     #4
                        CMP     samplerTargetA,     samplerLimitA       WZ
              IF_E      MOV     samplerTargetA,     samplerBaseA
                        SUB     samplerPostLeft,    #1
                        WAITCNT samplerStamp,       samplerWait
                        JMP     samplerTramp

samplerPreDone          MOV     t1,                 PAR
                        ADD     t1,                 #SAMPLEREND_OFF
                        WRLONG  samplerTargetA,     t1
                        JMP     #samplerFinish

samplerFinish           MOVS    samplerTramp,       #samplerOff

                        MOV     t1,                 #0
                        WRLONG  t1,                 samplerRunningA      'NB always sets Z
                        JMP     #samplerCommon

' VARIABLES stored in cog RAM (uninitialized)
t1                      RES 1
samplerTramp            RES 1
samplerRunningA         RES 1
samplerTrigVal          RES 1
samplerTrigMask         RES 1
samplerTrigStart        RES 1
samplerTargetA          RES 1
samplerLimitA           RES 1
samplerStamp            RES 1
samplerWait             RES 1
samplerBaseA            RES 1
samplerPreLeft          RES 1
samplerPostLeft         RES 1

                        FIT   ' make sure all instructions/data fit within the cog's RAM

'****************************