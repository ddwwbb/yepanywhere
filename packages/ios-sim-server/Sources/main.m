#import <CoreFoundation/CoreFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <VideoToolbox/VideoToolbox.h>
#import <objc/message.h>
#import <unistd.h>

typedef NS_ENUM(uint8_t, MessageType) {
  MessageTypeFrameRequest = 0x01,
  MessageTypeFrameResponse = 0x02,
  MessageTypeControl = 0x03,
};

static id SendId(id target, const char *selectorName) {
  SEL sel = sel_registerName(selectorName);
  return ((id(*)(id, SEL))objc_msgSend)(target, sel);
}

static id SendIdArg(id target, const char *selectorName, id arg) {
  SEL sel = sel_registerName(selectorName);
  return ((id(*)(id, SEL, id))objc_msgSend)(target, sel, arg);
}

static id SendIdArgArg(id target, const char *selectorName, id arg1, id arg2) {
  SEL sel = sel_registerName(selectorName);
  return ((id(*)(id, SEL, id, id))objc_msgSend)(target, sel, arg1, arg2);
}

static id SendIdArgError(id target, const char *selectorName, id arg, NSError **error) {
  SEL sel = sel_registerName(selectorName);
  return ((id(*)(id, SEL, id, NSError **))objc_msgSend)(target, sel, arg, error);
}

static BOOL SendBoolArgError(id target, const char *selectorName, id arg, NSError **error) {
  SEL sel = sel_registerName(selectorName);
  return ((BOOL(*)(id, SEL, id, NSError **))objc_msgSend)(target, sel, arg, error);
}

static NSString *DescribeObject(id obj) {
  if (!obj) return @"<nil>";
  @try {
    return [obj description];
  } @catch (NSException *exception) {
    return [NSString stringWithFormat:@"<description threw %@>", exception.name];
  }
}

static id ValueForKeySafe(id obj, NSString *key) {
  if (!obj) return nil;
  @try {
    return [obj valueForKey:key];
  } @catch (NSException *exception) {
    return nil;
  }
}

static BOOL WriteAll(int fd, const void *buffer, size_t length, NSError **error) {
  const uint8_t *cursor = (const uint8_t *)buffer;
  size_t remaining = length;
  while (remaining > 0) {
    ssize_t written = write(fd, cursor, remaining);
    if (written < 0) {
      if (error) {
        *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil];
      }
      return NO;
    }
    cursor += written;
    remaining -= (size_t)written;
  }
  return YES;
}

static BOOL ReadExact(int fd, void *buffer, size_t length, NSError **error) {
  uint8_t *cursor = (uint8_t *)buffer;
  size_t remaining = length;
  while (remaining > 0) {
    ssize_t n = read(fd, cursor, remaining);
    if (n == 0) {
      if (error) {
        *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:0 userInfo:@{
          NSLocalizedDescriptionKey: @"EOF",
        }];
      }
      return NO;
    }
    if (n < 0) {
      if (error) {
        *error = [NSError errorWithDomain:NSPOSIXErrorDomain code:errno userInfo:nil];
      }
      return NO;
    }
    cursor += n;
    remaining -= (size_t)n;
  }
  return YES;
}

static BOOL WriteHandshake(int fd, int width, int height, NSError **error) {
  uint8_t handshake[4];
  handshake[0] = (uint8_t)(width & 0xff);
  handshake[1] = (uint8_t)((width >> 8) & 0xff);
  handshake[2] = (uint8_t)(height & 0xff);
  handshake[3] = (uint8_t)((height >> 8) & 0xff);
  return WriteAll(fd, handshake, sizeof(handshake), error);
}

static BOOL WriteLengthPrefixedMessage(int fd, uint8_t type, NSData *payload, NSError **error) {
  uint32_t payloadLength = (uint32_t)payload.length;
  uint8_t header[5];
  header[0] = type;
  header[1] = (uint8_t)(payloadLength & 0xff);
  header[2] = (uint8_t)((payloadLength >> 8) & 0xff);
  header[3] = (uint8_t)((payloadLength >> 16) & 0xff);
  header[4] = (uint8_t)((payloadLength >> 24) & 0xff);
  if (!WriteAll(fd, header, sizeof(header), error)) {
    return NO;
  }
  if (payloadLength == 0) {
    return YES;
  }
  return WriteAll(fd, payload.bytes, payload.length, error);
}

static BOOL ReadLengthPrefixedPayload(int fd, NSMutableData **payloadOut, NSError **error) {
  uint8_t lengthBytes[4];
  if (!ReadExact(fd, lengthBytes, sizeof(lengthBytes), error)) {
    return NO;
  }
  uint32_t payloadLength = (uint32_t)lengthBytes[0] |
                           ((uint32_t)lengthBytes[1] << 8) |
                           ((uint32_t)lengthBytes[2] << 16) |
                           ((uint32_t)lengthBytes[3] << 24);
  NSMutableData *payload = [NSMutableData dataWithLength:payloadLength];
  if (payloadLength > 0 && !ReadExact(fd, payload.mutableBytes, payloadLength, error)) {
    return NO;
  }
  if (payloadOut) *payloadOut = payload;
  return YES;
}

typedef struct {
  NSData *jpegData;
  NSError *error;
} JPEGEncodeResult;

typedef struct {
  VTCompressionSessionRef session;
  int width;
  int height;
  JPEGEncodeResult *activeResult;
} JPEGEncoder;

static void CompressionOutputCallback(void *outputCallbackRefCon,
                                      void *sourceFrameRefCon,
                                      OSStatus status,
                                      VTEncodeInfoFlags infoFlags,
                                      CMSampleBufferRef sampleBuffer) {
  (void)sourceFrameRefCon;
  (void)infoFlags;

  JPEGEncoder *encoder = (JPEGEncoder *)outputCallbackRefCon;
  JPEGEncodeResult *result = encoder ? encoder->activeResult : NULL;
  if (result == NULL) {
    return;
  }
  if (status != noErr) {
    result->error = [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil];
    return;
  }
  if (sampleBuffer == NULL) {
    result->error = [NSError errorWithDomain:@"ios-sim-server"
                                        code:1
                                    userInfo:@{NSLocalizedDescriptionKey: @"VideoToolbox returned no sample buffer"}];
    return;
  }

  CMBlockBufferRef blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer);
  if (blockBuffer == NULL) {
    result->error = [NSError errorWithDomain:@"ios-sim-server"
                                        code:2
                                    userInfo:@{NSLocalizedDescriptionKey: @"Encoded sample buffer has no data buffer"}];
    return;
  }

  size_t length = CMBlockBufferGetDataLength(blockBuffer);
  NSMutableData *data = [NSMutableData dataWithLength:length];
  OSStatus copyStatus = CMBlockBufferCopyDataBytes(blockBuffer, 0, length, data.mutableBytes);
  if (copyStatus != noErr) {
    result->error = [NSError errorWithDomain:NSOSStatusErrorDomain code:copyStatus userInfo:nil];
    return;
  }

  result->jpegData = [data copy];
}

static BOOL CreateJPEGEncoder(int width, int height, JPEGEncoder *encoder, NSError **error) {
  if (!encoder) return NO;
  encoder->session = NULL;
  encoder->width = width;
  encoder->height = height;
  encoder->activeResult = NULL;

  VTCompressionSessionRef session = NULL;
  OSStatus status = VTCompressionSessionCreate(
      kCFAllocatorDefault,
      width,
      height,
      kCMVideoCodecType_JPEG,
      NULL,
      NULL,
      NULL,
      CompressionOutputCallback,
      encoder,
      &session);
  if (status != noErr) {
    if (error) *error = [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil];
    return NO;
  }

  VTSessionSetProperty(session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
  VTSessionSetProperty(session, kVTCompressionPropertyKey_Quality, (__bridge CFTypeRef)@(0.7));

  encoder->session = session;
  return YES;
}

static void DestroyJPEGEncoder(JPEGEncoder *encoder) {
  if (!encoder || !encoder->session) return;
  VTCompressionSessionInvalidate(encoder->session);
  CFRelease(encoder->session);
  encoder->session = NULL;
}

static NSData *EncodeJPEG(JPEGEncoder *encoder, CVPixelBufferRef pixelBuffer, NSError **error) {
  if (!encoder || !encoder->session) {
    if (error) {
      *error = [NSError errorWithDomain:@"ios-sim-server"
                                   code:10
                               userInfo:@{NSLocalizedDescriptionKey: @"JPEG encoder is not initialized"}];
    }
    return nil;
  }

  JPEGEncodeResult result = {0};
  encoder->activeResult = &result;

  CMTime pts = CMTimeMake(0, 1000);
  OSStatus status =
      VTCompressionSessionEncodeFrame(encoder->session, pixelBuffer, pts, kCMTimeInvalid, NULL, NULL, NULL);
  if (status == noErr) {
    status = VTCompressionSessionCompleteFrames(encoder->session, kCMTimeInvalid);
  }
  encoder->activeResult = NULL;

  if (status != noErr) {
    if (error) *error = [NSError errorWithDomain:NSOSStatusErrorDomain code:status userInfo:nil];
    return nil;
  }

  if (result.error != nil) {
    if (error) *error = result.error;
    return nil;
  }
  if (result.jpegData == nil) {
    if (error) {
      *error = [NSError errorWithDomain:@"ios-sim-server"
                                   code:3
                               userInfo:@{NSLocalizedDescriptionKey: @"No JPEG bytes returned"}];
    }
    return nil;
  }
  return result.jpegData;
}

static id FindBootedDevice(NSString *udid) {
  Class simServiceContextClass = NSClassFromString(@"SimServiceContext");
  Class simDeviceSetClass = NSClassFromString(@"SimDeviceSet");
  if (!simServiceContextClass || !simDeviceSetClass) {
    return nil;
  }

  NSError *ctxError = nil;
  NSString *developerDir = @"/Applications/Xcode.app/Contents/Developer";
  id serviceContext = nil;
  if ([simServiceContextClass respondsToSelector:sel_registerName("sharedServiceContextForDeveloperDir:error:")]) {
    serviceContext =
        SendIdArgError(simServiceContextClass, "sharedServiceContextForDeveloperDir:error:", developerDir, &ctxError);
  } else if ([simServiceContextClass respondsToSelector:sel_registerName("serviceContextForDeveloperDir:error:")]) {
    serviceContext =
        SendIdArgError(simServiceContextClass, "serviceContextForDeveloperDir:error:", developerDir, &ctxError);
  }
  if (!serviceContext || ctxError != nil) {
    fprintf(stderr, "Failed to create SimServiceContext: %s\n", DescribeObject(ctxError).UTF8String);
    return nil;
  }

  id defaultSetPath = SendId(simDeviceSetClass, "defaultSetPath");
  id deviceSetAlloc = SendId(simDeviceSetClass, "alloc");
  id deviceSet = SendIdArgArg(deviceSetAlloc, "initWithSetPath:serviceContext:", defaultSetPath, serviceContext);
  if (!deviceSet) {
    fprintf(stderr, "Failed to create SimDeviceSet\n");
    return nil;
  }

  NSError *subscribeError = nil;
  if ([deviceSet respondsToSelector:sel_registerName("subscribeToNotificationsWithError:")]) {
    SendBoolArgError(deviceSet, "subscribeToNotificationsWithError:", nil, &subscribeError);
  }
  if (subscribeError != nil) {
    fprintf(stderr, "subscribeToNotificationsWithError failed: %s\n", DescribeObject(subscribeError).UTF8String);
  }

  id devices = SendId(deviceSet, "devices");
  for (id device in devices) {
    NSString *deviceUDID = DescribeObject(ValueForKeySafe(device, @"UDID"));
    NSNumber *state = ValueForKeySafe(device, @"state");
    if (![deviceUDID isEqualToString:udid]) continue;
    if (state != nil && state.intValue != 3) {
      fprintf(stderr, "Device %s is not booted (state=%s)\n", udid.UTF8String, DescribeObject(state).UTF8String);
      return nil;
    }
    return device;
  }

  fprintf(stderr, "UDID not found in device set: %s\n", udid.UTF8String);
  return nil;
}

static IOSurfaceRef CopyFramebufferSurface(id device, int *widthOut, int *heightOut) {
  id io = SendId(device, "io");
  id ioPorts = ValueForKeySafe(io, @"ioPorts");
  for (id port in ioPorts) {
    if (![port respondsToSelector:sel_registerName("descriptor")]) continue;
    id descriptor = SendId(port, "descriptor");
    if (![descriptor respondsToSelector:sel_registerName("framebufferSurface")]) continue;

    id surfaceObj = SendId(descriptor, "framebufferSurface");
    if (!surfaceObj) continue;

    IOSurfaceRef surface = (__bridge IOSurfaceRef)surfaceObj;
    CFRetain(surface);
    if (widthOut) *widthOut = (int)IOSurfaceGetWidth(surface);
    if (heightOut) *heightOut = (int)IOSurfaceGetHeight(surface);
    return surface;
  }

  return nil;
}

static BOOL HandleControlPayload(NSData *payload, NSError **error) {
  if (payload.length == 0) {
    return YES;
  }

  id json = [NSJSONSerialization JSONObjectWithData:payload options:0 error:error];
  if (!json || ![json isKindOfClass:[NSDictionary class]]) {
    return NO;
  }

  NSString *cmd = json[@"cmd"];
  if (![cmd isKindOfClass:[NSString class]]) {
    return YES;
  }

  if ([cmd isEqualToString:@"touch"] ||
      [cmd isEqualToString:@"key"] ||
      [cmd isEqualToString:@"button"]) {
    // Capture-only daemon for now. Input plumbing is validated separately and
    // will be wired in without changing the framing contract.
    fprintf(stderr, "ios-sim-server: control command '%s' not implemented yet\n", cmd.UTF8String);
    return YES;
  }

  return YES;
}

static BOOL RunBenchmarkMode(NSString *udid, NSString *outputPath, int frameCount) {
  id device = FindBootedDevice(udid);
  if (!device) {
    return NO;
  }

  int width = 0;
  int height = 0;
  IOSurfaceRef surface = CopyFramebufferSurface(device, &width, &height);
  if (surface == nil) {
    fprintf(stderr, "Could not resolve framebufferSurface for device %s\n", udid.UTF8String);
    return NO;
  }

  CVPixelBufferRef pixelBuffer = NULL;
  NSDictionary *attrs = @{
    (id)kCVPixelBufferIOSurfacePropertiesKey: @{},
    (id)kCVPixelBufferMetalCompatibilityKey: @YES,
  };
  CVReturn cvStatus = CVPixelBufferCreateWithIOSurface(
      kCFAllocatorDefault,
      surface,
      (__bridge CFDictionaryRef)attrs,
      &pixelBuffer);
  CFRelease(surface);
  if (cvStatus != kCVReturnSuccess || pixelBuffer == NULL) {
    fprintf(stderr, "CVPixelBufferCreateWithIOSurface failed: %d\n", cvStatus);
    return NO;
  }

  NSError *encoderError = nil;
  JPEGEncoder encoder = {0};
  if (!CreateJPEGEncoder(width, height, &encoder, &encoderError)) {
    CVPixelBufferRelease(pixelBuffer);
    fprintf(stderr, "JPEG encoder creation failed: %s\n", DescribeObject(encoderError).UTF8String);
    return NO;
  }

  NSData *lastJPEG = nil;
  NSUInteger totalBytes = 0;
  CFAbsoluteTime startTime = CFAbsoluteTimeGetCurrent();

  for (int i = 0; i < frameCount; i++) {
    NSError *encodeError = nil;
    @autoreleasepool {
      NSData *jpegData = EncodeJPEG(&encoder, pixelBuffer, &encodeError);
      if (jpegData == nil) {
        DestroyJPEGEncoder(&encoder);
        CVPixelBufferRelease(pixelBuffer);
        fprintf(stderr, "JPEG encode failed on frame %d: %s\n", i + 1, DescribeObject(encodeError).UTF8String);
        return NO;
      }
      totalBytes += jpegData.length;
      lastJPEG = jpegData;
    }
  }

  CFAbsoluteTime elapsed = CFAbsoluteTimeGetCurrent() - startTime;
  DestroyJPEGEncoder(&encoder);
  CVPixelBufferRelease(pixelBuffer);

  if (![outputPath isEqualToString:@"-"]) {
    NSError *writeError = nil;
    BOOL wrote = [lastJPEG writeToFile:outputPath options:NSDataWritingAtomic error:&writeError];
    if (!wrote) {
      fprintf(stderr, "Failed to write JPEG: %s\n", DescribeObject(writeError).UTF8String);
      return NO;
    }
    printf("wrote %s (%lu bytes) %dx%d\n", outputPath.UTF8String, (unsigned long)lastJPEG.length, width, height);
  }

  double fps = elapsed > 0 ? ((double)frameCount / elapsed) : 0.0;
  double avgMs = frameCount > 0 ? ((elapsed * 1000.0) / (double)frameCount) : 0.0;
  unsigned long avgBytes =
      frameCount > 0 ? (unsigned long)(totalBytes / (NSUInteger)frameCount) : 0;
  printf("frames=%d elapsed=%.3fs fps=%.2f avg=%.2fms avgBytes=%lu\n",
         frameCount,
         elapsed,
         fps,
         avgMs,
         avgBytes);
  return YES;
}

static BOOL RunDaemonMode(NSString *udid) {
  id device = FindBootedDevice(udid);
  if (!device) {
    return NO;
  }

  int width = 0;
  int height = 0;
  IOSurfaceRef surface = CopyFramebufferSurface(device, &width, &height);
  if (surface == nil) {
    fprintf(stderr, "Could not resolve framebufferSurface for device %s\n", udid.UTF8String);
    return NO;
  }

  CVPixelBufferRef pixelBuffer = NULL;
  NSDictionary *attrs = @{
    (id)kCVPixelBufferIOSurfacePropertiesKey: @{},
    (id)kCVPixelBufferMetalCompatibilityKey: @YES,
  };
  CVReturn cvStatus = CVPixelBufferCreateWithIOSurface(
      kCFAllocatorDefault,
      surface,
      (__bridge CFDictionaryRef)attrs,
      &pixelBuffer);
  CFRelease(surface);
  if (cvStatus != kCVReturnSuccess || pixelBuffer == NULL) {
    fprintf(stderr, "CVPixelBufferCreateWithIOSurface failed: %d\n", cvStatus);
    return NO;
  }

  NSError *encoderError = nil;
  JPEGEncoder encoder = {0};
  if (!CreateJPEGEncoder(width, height, &encoder, &encoderError)) {
    CVPixelBufferRelease(pixelBuffer);
    fprintf(stderr, "JPEG encoder creation failed: %s\n", DescribeObject(encoderError).UTF8String);
    return NO;
  }

  NSError *handshakeError = nil;
  if (!WriteHandshake(STDOUT_FILENO, width, height, &handshakeError)) {
    DestroyJPEGEncoder(&encoder);
    CVPixelBufferRelease(pixelBuffer);
    fprintf(stderr, "Failed to write handshake: %s\n", DescribeObject(handshakeError).UTF8String);
    return NO;
  }

  while (YES) {
    uint8_t messageType = 0;
    NSError *readError = nil;
    if (!ReadExact(STDIN_FILENO, &messageType, 1, &readError)) {
      NSString *message = DescribeObject(readError);
      if ([message containsString:@"EOF"]) {
        break;
      }
      fprintf(stderr, "Failed to read message type: %s\n", message.UTF8String);
      DestroyJPEGEncoder(&encoder);
      CVPixelBufferRelease(pixelBuffer);
      return NO;
    }

    switch ((MessageType)messageType) {
      case MessageTypeFrameRequest: {
        NSError *encodeError = nil;
        NSData *jpegData = EncodeJPEG(&encoder, pixelBuffer, &encodeError);
        if (jpegData == nil) {
          fprintf(stderr, "JPEG encode failed: %s\n", DescribeObject(encodeError).UTF8String);
          DestroyJPEGEncoder(&encoder);
          CVPixelBufferRelease(pixelBuffer);
          return NO;
        }
        NSError *writeError = nil;
        if (!WriteLengthPrefixedMessage(STDOUT_FILENO, MessageTypeFrameResponse, jpegData, &writeError)) {
          fprintf(stderr, "Failed to write frame response: %s\n", DescribeObject(writeError).UTF8String);
          DestroyJPEGEncoder(&encoder);
          CVPixelBufferRelease(pixelBuffer);
          return NO;
        }
        break;
      }
      case MessageTypeControl: {
        NSMutableData *payload = nil;
        if (!ReadLengthPrefixedPayload(STDIN_FILENO, &payload, &readError)) {
          fprintf(stderr, "Failed to read control payload: %s\n", DescribeObject(readError).UTF8String);
          DestroyJPEGEncoder(&encoder);
          CVPixelBufferRelease(pixelBuffer);
          return NO;
        }
        NSError *controlError = nil;
        if (!HandleControlPayload(payload, &controlError)) {
          fprintf(stderr, "Control command failed: %s\n", DescribeObject(controlError).UTF8String);
        }
        break;
      }
      default:
        fprintf(stderr, "Unknown message type: 0x%02x\n", messageType);
        DestroyJPEGEncoder(&encoder);
        CVPixelBufferRelease(pixelBuffer);
        return NO;
    }
  }

  DestroyJPEGEncoder(&encoder);
  CVPixelBufferRelease(pixelBuffer);
  return YES;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      fprintf(stderr, "Usage:\n");
      fprintf(stderr, "  %s <SIMULATOR_UDID>\n", argv[0]);
      fprintf(stderr, "  %s --benchmark <SIMULATOR_UDID> <OUTPUT_JPEG_PATH|-> [FRAME_COUNT]\n", argv[0]);
      return 2;
    }

    if (strcmp(argv[1], "--benchmark") == 0) {
      if (argc < 4) {
        fprintf(stderr, "Usage: %s --benchmark <SIMULATOR_UDID> <OUTPUT_JPEG_PATH|-> [FRAME_COUNT]\n", argv[0]);
        return 2;
      }
      NSString *udid = [NSString stringWithUTF8String:argv[2]];
      NSString *outputPath = [NSString stringWithUTF8String:argv[3]];
      int frameCount = 1;
      if (argc >= 5) {
        frameCount = (int)strtol(argv[4], NULL, 10);
        if (frameCount <= 0) frameCount = 1;
      }
      return RunBenchmarkMode(udid, outputPath, frameCount) ? 0 : 1;
    }

    NSString *udid = [NSString stringWithUTF8String:argv[1]];
    return RunDaemonMode(udid) ? 0 : 1;
  }
}
