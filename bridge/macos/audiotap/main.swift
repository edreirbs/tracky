// tracky-audiotap: captura el audio del sistema (lo que suena en las bocinas: Teams, Zoom…) con un
// *Core Audio process tap* (macOS 14.2+) y lo escribe por stdout como PCM float32 LE, 16 kHz, mono.
//
// * No escribe nada a disco: solo a la tubería que abre el puente (tracky-bridge).
// * Termina cuando se cierra stdin (el puente se desconecta) o con SIGTERM/SIGINT.
// * macOS pide el permiso "Grabación de audio del sistema" una sola vez. Para que el permiso sea de
//   este programa (y no de Python o de la Terminal), se relanza a sí mismo "deslindado" del proceso
//   padre y lleva incrustado un Info.plist con NSAudioCaptureUsageDescription.
// * Por stderr solo escribe estados ("ready …", "error: …"), nunca audio ni texto.
//
// Compilar: bridge/macos/build-audiotap.sh  (T001b, ADR-0009)

import AVFoundation
import CoreAudio
import Darwin
import Foundation

func log(_ line: String) {
    FileHandle.standardError.write((line + "\n").data(using: .utf8)!)
}

func fail(_ code: String, _ status: OSStatus = 0) -> Never {
    log("error: \(code) \(status)")
    Tap.cleanup()
    exit(1)
}

// MARK: - Relanzamiento "deslindado" (el permiso de TCC queda a nombre de este binario)

typealias DisclaimFn = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32

enum Child {
    static var pid: pid_t = 0
}

/// Si es posible, relanza este binario como proceso "responsable" de sí mismo y espera su salida.
func runDisclaimedIfNeeded() {
    if getenv("MEETING_AUDIOTAP_CHILD") != nil { return }
    // RTLD_DEFAULT == (void *)-2 en macOS.
    guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim") else { return }
    let setDisclaim = unsafeBitCast(sym, to: DisclaimFn.self)
    guard let exe = Bundle.main.executablePath else { return }

    var attr: posix_spawnattr_t?
    guard posix_spawnattr_init(&attr) == 0 else { return }
    defer { posix_spawnattr_destroy(&attr) }
    guard setDisclaim(&attr, 1) == 0 else { return }

    setenv("MEETING_AUDIOTAP_CHILD", "1", 1)
    let argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
    var pid: pid_t = 0
    let rc = posix_spawn(&pid, exe, nil, &attr, argv, environ)
    guard rc == 0 else {
        unsetenv("MEETING_AUDIOTAP_CHILD")
        return // seguimos sin deslindar
    }
    Child.pid = pid
    signal(SIGTERM) { _ in kill(Child.pid, SIGTERM) }
    signal(SIGINT) { _ in kill(Child.pid, SIGTERM) }
    var status: Int32 = 0
    while waitpid(pid, &status, 0) == -1 && errno == EINTR {}
    let exited = (status & 0x7f) == 0
    exit(exited ? (status >> 8) & 0xff : 1)
}

// MARK: - Tap de Core Audio

enum Tap {
    static var tapID = AudioObjectID(kAudioObjectUnknown)
    static var aggregateID = AudioObjectID(kAudioObjectUnknown)
    static var procID: AudioDeviceIOProcID?
    static var converter: AVAudioConverter?

    static func cleanup() {
        if aggregateID != kAudioObjectUnknown {
            if let procID {
                AudioDeviceStop(aggregateID, procID)
                AudioDeviceDestroyIOProcID(aggregateID, procID)
            }
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }
}

func defaultOutputUID() -> String {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var deviceID = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID)
    guard status == noErr else { fail("default_output", status) }

    address.mSelector = kAudioDevicePropertyDeviceUID
    var uid: CFString = "" as CFString
    size = UInt32(MemoryLayout<CFString>.stride)
    status = withUnsafeMutablePointer(to: &uid) { AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, $0) }
    guard status == noErr else { fail("default_output_uid", status) }
    return uid as String
}

/// Escribe todo el búfer a stdout; si el puente cerró la tubería, termina.
func writeAll(_ pointer: UnsafeRawPointer, _ count: Int) {
    var offset = 0
    while offset < count {
        let n = write(STDOUT_FILENO, pointer + offset, count - offset)
        if n < 0 {
            if errno == EINTR { continue }
            Tap.cleanup()
            exit(0)
        }
        offset += n
    }
}

func startTap() {
    // Todo el audio del sistema (ningún proceso excluido), sin silenciar las bocinas.
    let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
    description.uuid = UUID()
    description.muteBehavior = .unmuted

    var status = AudioHardwareCreateProcessTap(description, &Tap.tapID)
    guard status == noErr else { fail("tap_create", status) }

    var formatAddress = AudioObjectPropertyAddress(
        mSelector: kAudioTapPropertyFormat,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var asbd = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.stride)
    status = AudioObjectGetPropertyData(Tap.tapID, &formatAddress, 0, nil, &size, &asbd)
    guard status == noErr else { fail("tap_format", status) }
    guard let inputFormat = AVAudioFormat(streamDescription: &asbd) else { fail("tap_format_unsupported") }

    let outputUID = defaultOutputUID()
    let aggregate: [String: Any] = [
        kAudioAggregateDeviceNameKey: "tracky-audiotap",
        kAudioAggregateDeviceUIDKey: UUID().uuidString,
        kAudioAggregateDeviceMainSubDeviceKey: outputUID,
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceIsStackedKey: false,
        kAudioAggregateDeviceTapAutoStartKey: true,
        kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
        kAudioAggregateDeviceTapListKey: [
            [kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: description.uuid.uuidString],
        ],
    ]
    status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &Tap.aggregateID)
    guard status == noErr else { fail("aggregate_create", status) }

    guard let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: true),
          let converter = AVAudioConverter(from: inputFormat, to: outputFormat)
    else { fail("converter") }
    converter.downmix = true // estéreo → mono mezclando ambos canales
    Tap.converter = converter
    let ratio = 16_000.0 / inputFormat.sampleRate

    let queue = DispatchQueue(label: "app.tracky.tracky-audiotap.io")
    status = AudioDeviceCreateIOProcIDWithBlock(&Tap.procID, Tap.aggregateID, queue) { _, inputData, _, _, _ in
        guard let input = AVAudioPCMBuffer(pcmFormat: inputFormat, bufferListNoCopy: inputData, deallocator: nil),
              input.frameLength > 0
        else { return }
        let capacity = AVAudioFrameCount(Double(input.frameLength) * ratio) + 64
        guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }
        var consumed = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, inputStatus in
            if consumed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            inputStatus.pointee = .haveData
            return input
        }
        if error == nil, output.frameLength > 0, let channels = output.floatChannelData {
            writeAll(UnsafeRawPointer(channels[0]), Int(output.frameLength) * MemoryLayout<Float>.size)
        }
    }
    guard status == noErr, let procID = Tap.procID else { fail("ioproc_create", status) }

    status = AudioDeviceStart(Tap.aggregateID, procID)
    guard status == noErr else { fail("device_start", status) }
    log("ready \(Int(inputFormat.sampleRate))Hz \(inputFormat.channelCount)ch → 16000Hz 1ch")
}

// MARK: - Apps que usan el micrófono (para saber cuándo terminó la junta, ADR-0012)

/// IDs de las apps que tienen el micrófono abierto ahora. No requiere permisos ni toca audio.
func appsUsingMicrophone() -> [String] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    let system = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
    var processes = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &processes) == noErr else { return [] }

    var apps: [String] = []
    for process in processes {
        var running: UInt32 = 0
        var runningSize = UInt32(MemoryLayout<UInt32>.size)
        var runningAddress = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyIsRunningInput,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectGetPropertyData(process, &runningAddress, 0, nil, &runningSize, &running) == noErr, running != 0 else { continue }
        var bundle: CFString = "" as CFString
        var bundleSize = UInt32(MemoryLayout<CFString>.stride)
        var bundleAddress = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyBundleID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = withUnsafeMutablePointer(to: &bundle) {
            AudioObjectGetPropertyData(process, &bundleAddress, 0, nil, &bundleSize, $0)
        }
        if status == noErr, !(bundle as String).isEmpty { apps.append(bundle as String) }
    }
    return apps
}

// MARK: - Principal

signal(SIGPIPE, SIG_IGN)

if CommandLine.arguments.contains("--mic-apps") {
    let data = try! JSONSerialization.data(withJSONObject: ["input": appsUsingMicrophone()])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(0)
}

runDisclaimedIfNeeded()

if #unavailable(macOS 14.2) {
    fail("macos_too_old")
}

startTap()

// Terminar limpio con SIGTERM/SIGINT…
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler {
        Tap.cleanup()
        exit(0)
    }
    source.resume()
    signalSources.append(source)
}

// …o cuando el puente cierra stdin.
DispatchQueue.global(qos: .utility).async {
    var buffer = [UInt8](repeating: 0, count: 64)
    while read(STDIN_FILENO, &buffer, buffer.count) > 0 {}
    DispatchQueue.main.async {
        Tap.cleanup()
        exit(0)
    }
}

dispatchMain()
